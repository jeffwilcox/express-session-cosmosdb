# express-session-cosmosdb [obviously, not maintained]

This is yet another implementation of an Express session provider, this one targeting 
Azure Cosmos DB.

While there were a previous generation of providers created for documentdb, or the older 
Cosmos libraries, this targets the 2020+-era Cosmos SDK and uses TypeScript.

This library is repackaged from the open source GitHub Management Portal used at Microsoft 
that I created as part of my day job. See also: https://github.com/microsoft/opensource-portal/blob/develop/lib/cosmosSession/index.ts

I am unofficially packaging up this for independent use in personal projects for the time
being, since it's such a basic library, and publishing into my own scoped NPM package for now.

# Preparing Cosmos DB for session storage

While you'll want to review the pricing details for Cosmos, the most important capability
used for session storage is time-to-live / TTL configuration. By default, Cosmos containers 
have TTL turned _off_.

When creating or configuring a new container:

- in the Azure Portal, go to the Scale and Settings for your container
- change TTL to either "On (no default)" or "On", and configure a default TTL value.

# Using the Cosmos DB Express session provider

## Configuring your Express middleware

While using Express, you simply initialize a new instance of the `CosmosSessionStore` object with
a set of properties, and your Cosmos DB will be used for storing the session.

To protect keys, this sample code assumes you are using the npm `dotnev` and `.env` files.

```
require('dotenv').config(); // load .env keys into process environment variables

import express from 'express';
import session from 'express-session';
import CosmosSessionStore from 'express-session-cosmosdb';

// ... standard Express middleware ...

const store = new CosmosSessionStore({
  endpoint: process.env.COSMOS_SESSION_ENDPOINT,
  database: process.env.COSMOS_SESSION_DATABASE,
  collection: process.env.COSMOS_SESSION_CONTAINER,
  key: process.env.COSMOS_SESSION_KEY,
});

const sess = {
  store,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    path: '/',
    httpOnly: true,
    secure: false,
  },
}

if (app.get('env') === 'production') {
  // IF using a load balancer in Azure - beware: app.set('trust proxy', 1) // trust first proxy
  sess.cookie.secure = true // serve secure cookies
}

app.use(session(sess))

// ... continue standard Express middleware ...

```

## Runtime information and debugging

The `debug` module is used to allow for sharing more verbose information at runtime. If
you set the environment variable `DEBUG` to include `express-session-cosmosdb` or `*`,
initialiation information will be shown.

Helpful debug information includes detailed errors during attempted Cosmos database and container
initialization, as well as diagnostics around time-to-life settings and defaults.

```
node DEBUG=express-session-cosmodb ./bin/www
```

## Options

The required options taken when constructing the `CosmosSessionStore` conforming to the interface `ICosmosSessionProviderOptions` are:

- **endpoint**: the URI endpoint of the Cosmos DB, directly copied from the Azure portal or CLI. Sample value: `https://espresso.documents.azure.com:443/`
- **key**: the primary or secondary key of the Cosmos DB, a base64-encoded key
- **database**: the name of the database
- **collection**: the name of the collection/container for storing sessions

Optional but strongly encouraged:

- **ttl**: optional, but strongly recommended unless using default TTL configured on a Cosmos container. The __number of seconds__ to keep around sessions.

Optional other parameters:

- **createDatabaseIfNotExists**: set to `true` to create the database if it does not exist. This could have billing implications.
- **createCollectionIfNotExists**: set to `true` to create the collection if it does not exist. This could have billing implications. The collection also will not have a TTL default or TTL support enabled.
- **skipVerifyDatabaseExists**: set to `true` to skip runtime validation that the database exists
- **skipVerifyCollectionExists**: set to `true` to skip runtime validation that the collection exists

# MIT License

This project was originally created as part of the `opensource-portal` project at 
Microsoft. This is a fork of the `./lib/cosmosSession/` folder, and maintains the 
Microsoft copyright and MIT license.

Contributors to this project may be asked to sign the Microsoft CLA.
