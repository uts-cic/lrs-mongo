# lrs-mongo
STEP II - Move Data from Remote LRS to Mongo DB

Node8.10/Serverless

Code fetches all the statements from the remote LRS and populates MongoDB.

This uses serverless to deploy lambda function to AWS and has all the environment variables set via serverless.yml. If you prefer this method create a new file serverless.yml alternavtively this can be set via the .env file

Following evn variables need to be set via .env or via serverless.yml
```
MONGO_URL: 
MONGO_DB_USER: 
MONGO_DB_PASSWORD: 
MONGO_DB: 
LRS_HOST: 
LRS_AUTH: 
```
