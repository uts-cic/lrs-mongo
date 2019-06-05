'use strict';

var https = require('https');
//var express =  require('express');
var mongoose = require('mongoose');
var AWS = require('aws-sdk');
var ADL = require('adl-xapiwrapper');

const MONGO_URL= process.env.MONGO_URL;
const MONGO_DB = process.env.MONGO_DB;
const MONGO_DB_USER= process.env.MONGO_DB_USER;
const MONGO_DB_PASSWORD=process.env.MONGO_DB_PASSWORD;

const Schema = mongoose.Schema;

// Set the region
AWS.config.update({region: 'ap-southeast-2'});


mongoose.Promise = global.Promise;
mongoose.connect(`mongodb://${MONGO_DB_USER}:${MONGO_DB_PASSWORD}@${MONGO_URL}:27017/${MONGO_DB}`, { useNewUrlParser: true });
mongoose.set('useFindAndModify', false);

mongoose.connection.on('connected', function () {
    console.log('Mongoose default connection open to ');
});

mongoose.connection.on('error',function (err) {
    console.log('Mongoose default connection error: ' + err);
});


const UserSchema = new Schema({
        email: {
            type: String,
            required : true
        },
        name : {
            type: String,
            required: true
        }

    }
);

/**
 *  change schema to match - applies to both Notes and Quizzes
 *  parentName -- course
 *  parentRef -- courseRef
 *
 *  groupName -- activity
 *  groupRef -- activityRef
 *
 *  subjectRef -- new field sis_course_id (can be null)
 *      this is stored as contextActivity [other]
 *          exists if and iff sis_course_id IS NOT NULL from Canvas/courses API
 *
 */

const NoteSchema = new Schema({
        platform: {
            type: String,
            required : true
        },
        title : {
            type: String,
            required: true
        },
        verb :{
          type: String,
          required: true
        },
        lrsRef: {
            type: String
        },
        objRef: {
          type: String
        },
        courseRef: {
            type: String
        },
        course: {
          type:String
        },
        subjectRef: {
          type: String
        },
        activityRef: {
            type: String
        },
        activity: {
            type:String
        },
        text :{
            type: String
        },
        createdAt: {
            type: String
        },
        updatedAt: {
            type: String
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        }

});

const QuizSchema = new Schema({
    platform: {
        type: String,
        required : true
    },
    title : {
        type: String,
        required: true
    },
    verb :{
        type: String,
        required: true
    },
    lrsRef: {
        type: String
    },
    objRef: {
        type: String
    },
    courseRef: {
        type: String
    },
    course: {
        type:String
    },
    subjectRef: {
        type: String
    },
    activityRef: {
        type: String
    },
    activity: {
        type:String
    },
    rawScore :{
        type: Schema.Types.Decimal128
    },
    scaledScore :{
        type: Schema.Types.Decimal128
    },
    createdAt: {
        type: String
    },
    updatedAt: {
        type: String
    },
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    }

});

var Note = mongoose.model('note', NoteSchema);
var User = mongoose.model('user', UserSchema);
var Quiz = mongoose.model('quiz', QuizSchema);
var more = '';


exports.handler = async (event, context) => {

    let statements = await getAllStatements();
    let users = await syncUsers(statements);
    let notes = await syncNotes(statements);

    return notes;

};

async function getAllStatements() {
    let cnt = 5;
    let all =[];

    let stmt = await getLRSData(more);
    all.push(stmt.statements);

    more = stmt.more ? stmt.more : "";
    do {
        let stmt = await getLRSData(more);

        more = stmt.more ? stmt.more : "";
        cnt--;
        all.push(stmt.statements);

    } while (more !== "");

    const stmts = await Promise.all(all);
    return stmts;
}


async function getLRSData(more) {
    let path = more==="" ? '/xapi/statements' : more;
    let body ='';
    return new Promise((resolve, reject) => {

        const options = {
            host: process.env.LRS_HOST,
            path: path,
            method: 'GET',
            headers: {
                'Cache-Control': 'no-cache',
                'Authorization': process.env.LRS_AUTH,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Experience-API-Version': '1.0.0'
            }
        };
        const req = https.request(options, (res) => {
            res.on('data', (chunk) => {
                body += chunk;
            });

            res.on('end', () => {
                let result = JSON.parse(body);
                return resolve(result);
            });
        });

        req.on('error', (e) => {
            reject(e.message);
        });
        // send the request
        req.write('');
        req.end();
    });

}

async function syncUsers(statements) {

    let lists = [];
    statements.forEach(ls => lists.push(...ls));

    if(lists.length > 0) {
        let users = lists.map((stmt) => {
            let em = stmt.actor.account.name;
             return { email: em, name: stmt.actor.name };
        });
        let usrDetails = users.map(async (user) => {
            let ds = await updateUser(user);
            return ds;
        });
        //get user details -- > add user if doe snot exist
        const details = await Promise.all(usrDetails);
        return details;
    }
    return [];

}

async function updateUser (user) {

    return new Promise((resolve, reject) => {
        User.findOneAndUpdate({email: user.email}, {$setOnInsert: user}, {upsert: true})
            .then(result => resolve(result))
            .catch(err => reject(err))
    });
}


async function syncNotes(statements) {
    let users = await User.find({});
    let lists = [];
    statements.forEach(ls => lists.push(...ls));

    if(lists.length > 0) {
        let notes = lists.map(async (stmt) => {
            if (stmt.object.definition.name["en-US"] === "Note") {
                let em = stmt.actor.account.name;
                let user = users.filter((usr) => {
                return usr.email === em;
                });
                let course = (typeof stmt.context.contextActivities.parent[0].definition !== 'undefined') ? stmt.context.contextActivities.parent[0].definition.name["en-US"] : "";
                let activity = (typeof stmt.context.contextActivities.grouping[0].definition !== 'undefined') ? stmt.context.contextActivities.grouping[0].definition.name["en-US"] : "";
                let sis_course_id = (typeof stmt.context.contextActivities.other !== 'undefined') ? stmt.context.contextActivities.other[0].definition.name["en-US"] : "";

                let note = cloneNote();
                note.platform = stmt.context.platform;
                note.title = course;
                note.verb = stmt.verb.display["en-US"];
                note.lrsRef = stmt.id;
                note.objRef = stmt.object.id;
                note.courseRef = stmt.context.contextActivities.parent[0].id;
                note.course = course;
                note.activityRef = stmt.context.contextActivities.grouping[0].id;
                note.activity = activity;
                note.subjectRef = sis_course_id;
                note.text = (typeof stmt.result === 'undefined') ? '': stmt.result.response;
                note.createdAt = stmt.timestamp;
                note.updatedAt = stmt.stored;
                note.user = user[0]._id;

                let nds = await updateNotes(note);
                return nds;


            } else {
                return {};
            }

        });

        let quizzes = lists.map(async (stmt) => {
            if(stmt.object.definition.name["en-US"] === "Quiz") {
                let em = stmt.actor.account.name;
                let user = users.filter((usr) => {
                    return usr.email === em;
                });
                let course = (typeof stmt.context.contextActivities.parent[0].definition !== 'undefined') ? stmt.context.contextActivities.parent[0].definition.name["en-US"] : "";
                let activity = (typeof stmt.context.contextActivities.grouping[0].definition !== 'undefined') ? stmt.context.contextActivities.grouping[0].definition.name["en-US"] : "";
                let sis_course_id = (typeof stmt.context.contextActivities.other !== 'undefined') ? stmt.context.contextActivities.other[0].definition.name["en-US"] : "";

                let quiz = cloneQuiz();
                quiz.platform = stmt.context.platform;
                quiz.title = course;
                quiz.verb = stmt.verb.display["en-US"];
                quiz.lrsRef = stmt.id;
                quiz.objRef = stmt.object.id;
                quiz.courseRef= stmt.context.contextActivities.parent[0].id;
                quiz.course= course;
                quiz.activityRef = stmt.context.contextActivities.grouping[0].id;
                quiz.activity = activity;
                quiz.subjectRef = sis_course_id;
                if(stmt.verb.display["en-US"]==="completed") {
                    quiz.rawScore = stmt.result.score.raw;
                    quiz.scaledScore = stmt.result.score.scaled;
                }
                quiz.createdAt = stmt.timestamp;
                quiz.updatedAt = stmt.stored;
                quiz.user = user[0]._id;

                let qds = await updateQuiz(quiz);
                return qds;
            } else {
                return {};
            }
        });

        const details = await Promise.all(notes, quizzes);
        return details;
    }
    return [];

}

async function updateNotes (note) {

    return new Promise((resolve, reject) => {
        Note.findOneAndUpdate({lrsRef: note.lrsRef}, {$setOnInsert: note}, {upsert: true})
            .then(result => resolve(result))
            .catch(err => reject(err))
    });

}

async function updateQuiz (quiz) {

    return new Promise((resolve, reject) => {
        Quiz.findOneAndUpdate({lrsRef: quiz.lrsRef}, {$setOnInsert: quiz}, {upsert: true})
            .then(result => resolve(result))
            .catch(err => reject(err))
    });

}

function cloneNote() {
    let note = {
        platform: "",
        title:"",
        verb:"",
        lrsRef: "",
        objRef: "",
        courseRef: "",
        course:"",
        activityRef: "",
        activity: "",
        subjectRef:"",
        text :"",
        createdAt: "",
        updatedAt: "",
        user: ""
    };
    return Object.assign({}, note);
}

function cloneQuiz() {
    let quiz = {
        platform: "",
        title:"",
        verb:"",
        lrsRef: "",
        objRef: "",
        courseRef: "",
        course:"",
        activityRef: "",
        activity: "",
        subjectRef:"",
        scaledScore :0,
        rawScore:0,
        createdAt: "",
        updatedAt: "",
        user: ""
    };
    return Object.assign({}, quiz);
}