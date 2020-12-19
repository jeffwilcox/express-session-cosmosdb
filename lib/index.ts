//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CosmosClient, Database, Container } from '@azure/cosmos';
import { Session, Store } from 'express-session';
import Debug from 'debug';

const debug = Debug('express-session-cosmosdb');

export interface CosmosSessionError extends Error {
  innerError: Error;
  endpoint: string;
  database?: string;
  collection?: string;
}

export interface ICosmosSessionProviderOptions {
  endpoint: string;
  key: string;
  ttl?: number;
  database?: string;
  collection?: string;

  createDatabaseIfNotExists?: boolean;
  createCollectionIfNotExists?: boolean;
  skipVerifyDatabaseExists?: boolean;
  skipVerifyCollectionExists?: boolean;
}

export default class CosmosSessionStore extends Store {
  #options: ICosmosSessionProviderOptions;
  #client: CosmosClient;
  #initialized: boolean;
  #database: Database;
  #collection: Container;

  constructor(options: ICosmosSessionProviderOptions) {
    super();

    this.#initialized = false;
    this.#database = null as any as Database;
    this.#collection = null as any as Container;
    this.#options = options;
    const { endpoint, key } = this.#options;
    if (!endpoint) {
      throw new Error('options.endpoint required');
    }
    if (!key) {
      throw new Error('options.key required');
    }
    if (!this.#options.collection) {
      throw new Error('options.collection required');
    }
    if (!this.#options.database) {
      throw new Error('options.database required');
    }
    this.#client = new CosmosClient({ endpoint, key });
  }

  async initialize() {
    if (this.#initialized) {
      return;
    }
    const { createDatabaseIfNotExists, database, endpoint, skipVerifyDatabaseExists } = this.#options;
    if (createDatabaseIfNotExists) {
      this.#database = (await this.#client.databases.createIfNotExists({ id: database })).database;
    } else {
      this.#database = this.#client.database(this.#options.database as string);
      if (!skipVerifyDatabaseExists) {
        try {
          const info = await this.#database.read();
          debug(`Verified connection to ${database} at ${endpoint}: activityId=${info.activityId}, etag=${info.etag}`);
        } catch (verifyError) {
          debug(`Could not verify the database ${database} at ${endpoint}: ${verifyError}`);
          const error = new Error('Could not verify connection to CosmosDB for session storage') as CosmosSessionError;
          error.innerError = verifyError;
          error.endpoint = endpoint;
          error.database = database;
          throw error;
        }
      }
    }
    const { createCollectionIfNotExists, collection, skipVerifyCollectionExists } = this.#options;
    let verifiedTtl = false;
    if (createCollectionIfNotExists) {
      this.#collection = (await this.#database.containers.createIfNotExists({ id: collection })).container;
    } else {
      this.#collection = this.#database.container(collection as string);
      if (!skipVerifyCollectionExists) {
        try {
          const info = await this.#collection.read();
          debug(`Verified container ${collection} in ${database}: activityId=${info.activityId}, etag=${info.etag}`);
          if (!info?.resource?.defaultTtl) {
            debug(`WARNING: TTL is not configured for the container ${collection}, sessions will not be automatically garbage collected`);
          } else if (!this.#options.ttl && info?.resource?.defaultTtl === -1) {
            debug(`WARNING: options.ttl is not set for the CosmosSessionStore; the ${collection} container has TTL turned on, but with no default, so sessions will not automatically be garbage collected`);
          } else {
            debug(`Container ${collection} has a configured TTL of ${info?.resource?.defaultTtl} and options.ttl is ${this.#options.ttl} seconds`);
          }
        } catch (verifyError) {
          debug(`Could not verify the collection ${collection} in database ${database} at ${endpoint}: ${verifyError}`);
          const error = new Error('Could not verify session storage container') as CosmosSessionError;
          error.innerError = verifyError;
          error.endpoint = endpoint;
          error.database = database;
          error.collection = collection;
          throw error;
        }
      }
    }
    this.#initialized = true;
  }

  get = (sid: string, callback: (err: any, session?: any | null) => void) => {
    this.initialize().then(nothing => this.#collection.item(sid, sid).read().then(response => {
      if (response.resource) {
        const clone = Object.assign({}, response.resource);
        delete clone._attachments;
        delete clone._etag;
        delete clone._rid;
        delete clone._self;
        delete clone._ts;
        delete clone.ttl;
        if (callback) {
          return callback(null, clone);
        }
      } else {
        return callback(null, null);
      }
    }).catch(error => {
      // TODO:
      console.dir(error);
      if (callback) {
        return callback(error);
      }
    }));
  };

  // This required method is used to upsert a session into the store given a session 
  // ID (sid) and session (session) object. The callback should be called as 
  // callback(error) once the session has been set in the store.
  destroy = (sid: string, callback?: (err?: any) => void) => {
    this.initialize().then(nothing => this.#collection.item(sid, sid).delete().then(ok => {
      if (callback) {
        return callback();
      }
    }).catch(error => {
      console.dir(error);
      if (callback) {
        return callback();
        // We do not bubble any errors here.
      }
    }));
  };

  // The session argument should be a session if found, otherwise null or undefined if the 
  // session was not found (and there was no error). A special case is made when 
  // error.code === 'ENOENT' to act like callback(null, null).
  set = (sid: string, session: Session, callback?: (err?: any) => void) => {
    if (sid !== session.id) {
      const error = new Error('The \'sid\' parameter value must match the value of \'session.id\'.');
      if (callback) {
        return callback(error);
      }
      throw error;
    }
    // TODO: what if there is no TTL property?
    const item = Object.assign({}, session, {
      id: sid,
      ttl: this.#options.ttl,
      seen: new Date(),
    });
    this.initialize().then(nothing => this.#collection.items.upsert(item).then(ok => {
      if (callback) {
        return callback();
      }
    }).catch(error => {
      // TODO:
      console.dir(error);
      if (callback) {
        return callback(new Error(`Error upserting data to the database: ${error}`));
      }
    }));
  };

  // This recommended method is used to "touch" a given session given a session ID 
  // (sid) and session (session) object. The callback should be called as 
  // callback(error) once the session has been touched.
  //
  // This is primarily used when the store will automatically delete idle sessions 
  // and this method is used to signal to the store the given session is active, 
  // potentially resetting the idle timer.
  touch = (sid: string, session: Session, callback?: () => void) => {
    this.set(sid, session, callback);
  };

  // optional: all: (callback: (err: any, obj?: { [sid: string]: IAppSession; } | null) => void) => void;
  // optional: length: (callback: (err: any, length?: number | null) => void) => void;
  // optional: clear: (callback?: (err?: any) => void) => void;
}
