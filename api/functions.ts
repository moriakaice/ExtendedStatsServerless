import { Callback } from 'aws-lambda';
import {
    doGetNews, doQuery, gatherGeekSummary, doPlaysQuery,
    gatherSystemStats, listUsers, listWarTable, rankGames, updateFAQCount
} from "./mysql-rds";
import { asyncReturnWithConnection } from "./library";
import { GeekGameQuery, PlaysQuery } from "extstats-core";

export async function getGeekSummary(event, context, callback: Callback) {
    try {
        callback(undefined, await gatherGeekSummary(event["query"]["geek"]));
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

export async function incFAQCount(event, context, callback: Callback) {
    try {
        callback(undefined, await updateFAQCount(event.body as number[]));
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

export async function adminGatherSystemStats(event, context, callback: Callback) {
    try {
        callback(undefined, await gatherSystemStats());
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

// Lambda to retrieve the list of users
export async function getUserList(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
        callback(undefined, await listUsers());
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

// Lambda to retrieve the data for the war table.
export async function getWarTable(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
        callback(undefined, await listWarTable());
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

export async function query(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    if (event && event.body) {
        const query = event.body as GeekGameQuery;
        try {
            const result = await asyncReturnWithConnection(async conn => await doQuery(conn, query));
            callback(undefined, result);
        } catch (err) {
            console.log(err);
            callback(err);
        }
    } else {
        callback();
    }
}

export async function plays(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    if (event && event.body) {
        const query = event.body as PlaysQuery;
        try {
            const result = await asyncReturnWithConnection(async conn => await doPlaysQuery(conn, query));
            callback(undefined, result);
        } catch (err) {
            console.log(err);
            callback(err);
        }
    } else {
        callback();
    }
}

export async function getNews(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
        const result = await asyncReturnWithConnection(async conn => await doGetNews(conn));
        callback(undefined, result);
    } catch (err) {
        console.log(err);
        callback(err);
    }
}

export async function getRankings(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    if (event && event.body) {
        const query = {}; // TODO
        try {
            callback(undefined, await rankGames(query));
        } catch (err) {
            console.log(err);
            callback(err);
        }
    } else {
        callback();
    }
}
