import {Callback} from 'aws-lambda';
import {
    doGetCollection, doGetCollectionWithPlays, doQuery, gatherGeekSummary,
    gatherSystemStats,
    listUsers,
    listWarTable,
    rankGames, updateFAQCount
} from "./mysql-rds";
import {asyncReturnWithConnection} from "./library";
import {GeekGameQuery} from "extstats-core";

export async function getGeekSummary(event, context, callback: Callback) {
    try {
        callback(null, await gatherGeekSummary(event["query"]["geek"]));
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

export async function incFAQCount(event, context, callback: Callback) {
    try {
        callback(null, await updateFAQCount(event.body as number[]));
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

export async function adminGatherSystemStats(event, context, callback: Callback) {
    try {
        callback(null, await gatherSystemStats());
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

// Lambda to retrieve the list of users
export async function getUserList(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
        callback(null, await listUsers());
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

// Lambda to retrieve the data for the war table.
export async function getWarTable(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
        callback(null, await listWarTable());
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

export async function getCollection(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    if (event && event.body) {
        const query = event.body as GeekGameQuery;
        try {
            const collection = await asyncReturnWithConnection(async conn => await doGetCollection(conn, query));
            callback(null, collection);
        } catch (err) {
            console.log(err);
            callback(err);
        }
    } else {
        callback(null);
    }
}

export async function query(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    if (event && event.body) {
        const query = event.body as GeekGameQuery;
        try {
            const result = await asyncReturnWithConnection(async conn => await doQuery(conn, query));
            callback(null, result);
        } catch (err) {
            console.log(err);
            callback(err);
        }
    } else {
        callback(null);
    }
}

export async function getCollectionWithPlays(event, context, callback: Callback) {
    if (event && event.body) {
        const query = event.body as GeekGameQuery;
        try {
            const collection = await asyncReturnWithConnection(async conn => await doGetCollectionWithPlays(conn, query));
            callback(null, collection);
        } catch (err) {
            console.log(err);
            callback(err);
        }
    } else {
        callback(null);
    }
}

export async function getRankings(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    if (event && event.body) {
        const query = {}; // TODO
        try {
            callback(null, await rankGames(query));
        } catch (err) {
            console.log(err);
            callback(err);
        }
    } else {
        callback(null);
    }
}
