// Functions which access the database.
// Functions in this file may not get their own database connection.
// Exported functions in this file have a name starting with do and take a connection as their first parameter.
// This file may not import from functions or service.

import mysql = require('promise-mysql');
import {
    CollectionGame, MetadataRule,
    MonthPlayed, NormalisedPlays, PlayData,
    ProcessGameResult, ProcessPlaysResult,
    SeriesMetadata,
    ToProcessElement, WorkingNormalisedPlays
} from "./interfaces";
import { RankingTableRow, WarTableRow, ExpansionData } from "extstats-core";
import {
    count, extractNormalisedPlayFromPlayRow, listIntersect, listMinus, playDate
} from "./library";
import * as _ from "lodash";
import {inferExtraPlays} from "./plays";

export async function doUpdateMetadata(conn: mysql.Connection, series: SeriesMetadata[], rules: MetadataRule[]) {
    await doUpdateSeries(conn, series);
    await doUpdateMetadataRules(conn, rules);
}

async function doUpdateSeries(conn: mysql.Connection, seriesMetada: SeriesMetadata[]) {
    const deleteSql = "delete from series where series_id = ?";
    const insertSql = "insert into series (series_id, game) values ?";
    const gamesThatDontExist = await getGamesThatDontExist(conn);
    for (const sm of seriesMetada) {
        const sid = await doGetOrCreateSeriesMetadata(conn, sm.name);
        const gamesToUse = listMinus(sm.games, gamesThatDontExist);
        await doEnsureGames(conn, gamesToUse);
        await conn.query(deleteSql, sid);
        const values = [];
        for (const game of gamesToUse) {
            values.push([sid, game]);
        }
        console.log(values);
        await conn.query(insertSql, [values]);
    }
}

async function doGetOrCreateSeriesMetadata(conn: mysql.Connection, name: string): Promise<number> {
    const findSql = "select id from series_metadata where name = ?";
    const insertSql = "insert into series_metadata (name) values (?)";
    const findResults = await conn.query(findSql, [name]);
    if (findResults.length === 0) {
        await conn.query(insertSql, [name]);
        // look up the autoincremented ID in the row we just created
        return (await conn.query(findSql, [name]))[0]["id"];
    } else {
        return findResults[0]["id"];
    }
}

async function doUpdateMetadataRules(conn: mysql.Connection, rules: MetadataRule[]) {
    const deleteSql = "delete from metadata";
    const insertSql = "insert into metadata  (ruletype, game) values (?,?)";
    const gamesThatDontExist = await getGamesThatDontExist(conn);
    const gamesToUse = listMinus(rules.map(r => r.game), gamesThatDontExist);
    await doEnsureGames(conn, gamesToUse);
    await conn.query(deleteSql);
    for (const rule of rules.filter(r => gamesToUse.indexOf(r.game) >= 0)) {
        await conn.query(insertSql, [rule.rule, rule.game]);
    }
}

export async function doRecordGameExpansions(conn: mysql.Connection, gameId: number, expansions: number[]) {
    const deleteSql = "delete from expansions where basegame = ?";
    const insertSql = "insert into expansions (basegame, expansion) values (?, ?)";
    await conn.query(deleteSql, gameId);
    for (const exp of expansions) {
        try {
            await conn.query(insertSql, [gameId, exp]);
        } catch (e) {
            // probably foreign key constraint because the expansion is not in the database
            // I see no need to put it there.
        }
    }
}

async function doEnsureCategory(conn: mysql.Connection, name: string) {
    const insertSql = "insert into categories (name) values (?)";
    // very likely already there so ignore any error
    await conn.query(insertSql, [name]).catch(err => {});
}

async function doEnsureMechanic(conn: mysql.Connection, name: string) {
    const insertSql = "insert into mechanics (name) values (?)";
    // very likely already there so ignore any error
    await conn.query(insertSql, [name]).catch(err => {});
}

async function doSetCategoriesForGame(conn: mysql.Connection, game: number, categories: string[]) {
    const getCatsSqlOne = "select id from categories where name = ?";
    const getCatsSqlMany = "select id from categories where name in (?)";
    const deleteAllGameCatsSql = "delete from game_categories where game = ?";
    const insertSql = "insert into game_categories (game, category) values (?,?)";
    let getCatsSql;
    let getCatsParams;
    if (categories.length === 1) {
        getCatsSql = getCatsSqlOne;
        getCatsParams = categories;
    } else if (categories.length > 1) {
        getCatsSql = getCatsSqlMany;
        getCatsParams = [categories];
    } else {
        await conn.query(deleteAllGameCatsSql, [game]);
        return;
    }
    for (const cat of categories) {
        await doEnsureCategory(conn, cat);
    }
    const catIds = (await conn.query(getCatsSql, getCatsParams)).map(row => row.id);
    await conn.query(deleteAllGameCatsSql, [game]);
    for (const id of catIds) {
        await conn.query(insertSql, [game, id]);
    }
}

async function doSetMechanicsForGame(conn: mysql.Connection, game: number, mechanics: string[]) {
    const getMecsSqlOne = "select id from mechanics where name = ?";
    const getMecsSqlMany = "select id from mechanics where name in (?)";
    const deleteAllGameMecsSql = "delete from game_mechanics where game = ?";
    const insertSql = "insert into game_mechanics (game, mechanic) values (?,?)";
    let getMecsSql;
    let getMecsParams;
    if (mechanics.length === 1) {
        getMecsSql = getMecsSqlOne;
        getMecsParams = mechanics;
    } else if (mechanics.length > 1) {
        getMecsSql = getMecsSqlMany;
        getMecsParams = [mechanics];
    } else {
        await conn.query(deleteAllGameMecsSql, [game]);
        return;
    }
    for (const mec of mechanics) {
        await doEnsureMechanic(conn, mec);
    }
    const mecIds = (await conn.query(getMecsSql, getMecsParams)).map(row => row.id);
    await conn.query(deleteAllGameMecsSql, [game]);
    for (const id of mecIds) {
        await conn.query(insertSql, [game, id]);
    }
}

async function doUpdateGame(conn: mysql.Connection, data: ProcessGameResult) {
    const countSql = "select count(*) from games where bggid = ?";
    const insertSql = "insert into games (bggid, name, average, rank, yearPublished, minPlayers, maxPlayers, playTime, usersRated, usersTrading, usersWishing, " +
        "averageWeight, bayesAverage, numComments, usersOwned, subdomain) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    const updateSql = "update games set name = ?, average = ?, rank = ?, yearPublished = ?, minPlayers = ?, maxPlayers = ?, playTime = ?, usersRated = ?, usersTrading = ?, usersWishing = ?, " +
        "averageWeight = ?, bayesAverage = ?, numComments = ?, usersOwned = ?, subdomain = ? where bggid = ?";
    const c = await count(conn, countSql, [data.gameId]);
    if (c == 0) {
        await conn.query(insertSql, [data.gameId, data.name, data.average, data.rank, data.yearPublished, data.minPlayers,
            data.maxPlayers, data.playTime, data.usersRated, data.usersTrading, data.usersWishing, data.averageWeight, data.bayesAverage,
            data.numComments, data.usersOwned, data.subdomain]);
    } else {
        await conn.query(updateSql, [data.name, data.average, data.rank, data.yearPublished, data.minPlayers,
            data.maxPlayers, data.playTime, data.usersRated, data.usersTrading, data.usersWishing, data.averageWeight, data.bayesAverage,
            data.numComments, data.usersOwned, data.subdomain, data.gameId]);
    }
    await doSetCategoriesForGame(conn, data.gameId, data.categories);
    await doSetMechanicsForGame(conn, data.gameId, data.mechanics);
    await doUpdateRankingTableStatsForGame(conn, data.gameId, data);
}

async function doUpdateRankingTableStatsForGame(conn: mysql.Connection, game: number, data: ProcessGameResult) {
    const ratingSql = "select sum(rating), count(rating) from geekgames where game = ? and rating > 0";
    const insertSql = "insert into ranking_table (game, game_name, total_ratings, num_ratings, bgg_ranking, bgg_rating, normalised_ranking, total_plays) values (?,?,?,?,?,?,?,?)";
    const updateSql = "update ranking_table set game_name = ?, total_ratings = ?, num_ratings = ?, bgg_ranking = ?, bgg_rating = ?, normalised_ranking = ?, total_plays = ? where game = ?";
    const howManyPlaysSql = "select sum(plays_normalised.quantity) s from plays_normalised where plays_normalised.game = ?";
    const ratings = await conn.query(ratingSql, [game]);
    const total = ratings[0]['sum(rating)'];
    const count = ratings[0]['count(rating)'];
    const howManyPlays = (await conn.query(howManyPlaysSql, [game]))[0]["s"];
    const row: RankingTableRow = {
        game: game,
        game_name: data.name,
        bgg_ranking: data.rank || 1000000,
        bgg_rating: data.average || 0,
        normalised_ranking: 0,
        total_plays: howManyPlays,
        total_ratings: total || 0,
        num_ratings: count,
        ranking: 0
    };
    try {
        await conn.query(insertSql, [row.game, row.game_name, row.total_ratings, row.num_ratings, row.bgg_ranking, row.bgg_rating, row.normalised_ranking, row.total_plays]);
    } catch (e) {
        await conn.query(updateSql, [row.game_name, row.total_ratings, row.num_ratings, row.bgg_ranking, row.bgg_rating, row.normalised_ranking, row.total_plays, row.game]);
    }
}

async function doUpdateUserValues(conn: mysql.Connection, geek: string, bggid: number, country: string) {
    const sql = "update geeks set country = ?, bggid = ? where username = ?";
    await conn.query(sql, [country, bggid, geek]);
}

export async function doUpdateProcessUserResult(conn: mysql.Connection, geek: string, bggid: number, country: string, url: string) {
    await doUpdateUserValues(conn, geek, bggid, country);
    await doMarkUrlProcessed(conn, "processUser", url);
}

export async function doProcessGameResult(conn: mysql.Connection, data: ProcessGameResult) {
    await doUpdateGame(conn, data);
    await doRecordGameExpansions(conn, data.gameId, data.expansions);
    await doMarkUrlProcessed(conn, "processGame", data.url);
}

export async function doProcessCollectionCleanup(conn: mysql.Connection, geek: string, items: number[], url: string) {
    const geekid = await getGeekId(conn, geek);
    await doRestrictCollectionToGames(conn, geekid, items);
    await doMarkUrlProcessed(conn, "processCollection", url);
    await doUpdateFrontPageGeek(conn, geek);
}

async function doRestrictCollectionToGames(conn: mysql.Connection, geekid: number, items: number[]) {
    const deleteStatementSome = "delete from geekgames where geekid = ? and game not in (?)";
    const deleteStatementOne = "delete from geekgames where geekid = ? and game != ?";
    const deleteStatementNone = "delete from geekgames where geekid = ?";
    let deleteStatement;
    let params;
    if (items.length === 0) {
        deleteStatement = deleteStatementNone;
        params = [geekid];
    } else if (items.length == 1) {
        deleteStatement = deleteStatementOne;
        params = [geekid, items[0]];
    } else {
        deleteStatement = deleteStatementSome;
        params = [geekid, items];
    }
    await conn.query(deleteStatement, params);
}

// longest possible MySQL time is 838:59:59 hours: http://dev.mysql.com/doc/refman/5.5/en/date-and-time-type-overview.html
const TILL_NEXT_UPDATE = { "processCollection" : "72:00:00", "processMarket" : "72:00:00", "processPlayed" : "72:00:00",
    "processGame" : "838:00:00", "processTop50" : "72:00:00", "processFrontPage" : "24:00:00", "processUser": "838:00:00"  };

function about3Days() {
    const minutes = 3600 + Math.floor(Math.random() * 1440);
    const ms = minutes % 60;
    return "" + Math.floor(minutes / 60) + ":" + (ms < 10 ? "0" : "") + ms + ":00";
}

function tillNextUpdate(processMethod: string) {
    const orig = TILL_NEXT_UPDATE[processMethod];
    return (orig === "72:00:00") ? about3Days() : orig;
}

export async function doMarkUrlProcessed(conn: mysql.Connection, processMethod: string, url: string) {
    const delta = tillNextUpdate(processMethod);
    const sqlSet = "update files set lastUpdate = now(), nextUpdate = addtime(now(), ?) where url = ? and processMethod = ?";
    await conn.query(sqlSet, [delta, url, processMethod]);
}

export async function doMarkUrlProcessedWithUpdate(conn: mysql.Connection, processMethod: string, url: string, delta: string) {
    const sqlSet = "update files set lastUpdate = now(), nextUpdate = addtime(now(), ?) where url = ? and processMethod = ?";
    await conn.query(sqlSet, [delta, url, processMethod]);
}

export async function doMarkUrlUnprocessed(conn: mysql.Connection, processMethod: string, url: string) {
    const sqlSet = "update files set last_scheduled = null where url = ? and processMethod = ?";
    await conn.query(sqlSet, [url, processMethod]);
}

export async function doMarkUrlTryTomorrow(conn: mysql.Connection, processMethod: string, url: string) {
    const sqlSet = "update files set last_scheduled = addtime(now(), '24:00:00') where url = ? and processMethod = ?";
    await conn.query(sqlSet, [url, processMethod]);
}

export async function doMarkGameDoesNotExist(conn: mysql.Connection, bggid: number) {
    const insertSql = "insert into not_games (bggid) values (?)";
    const deleteSql1 = "delete from files where processMethod = 'processGame' and bggid = ?";
    const deleteSql2 = "delete from geekgames where game = ?";
    try {
        await conn.query(insertSql, [bggid]);
    } catch (e) {
        // ignore error if it's already there
    }
    await conn.query(deleteSql1, [bggid]);
    await conn.query(deleteSql2, [bggid]);
}

export async function doEnsureUsers(conn: mysql.Connection, users: string[]) {
    const extraSql = "select username from geeks where username not in (?)";
    const extraUsers = (await conn.query(extraSql, [users])).map(it => it.username);
    for (const user of users) {
        await doEnsureUser(conn, user);
    }
    await doDeleteExtraUsers(conn, extraUsers);
}

async function doDeleteExtraUsers(conn: mysql.Connection, extraUsers: string[]) {
    console.log("Deleting " + extraUsers.length + " unwanted users.");
    const idsToDelete = [];
    for (const u of extraUsers) {
        const geekId = await getGeekId(conn, u);
        idsToDelete.push(geekId);
    }
    const deleteOneFile = "delete from files where geek = ?";
    const deleteOneGeek = "delete from geeks where username = ?";
    const deleteSomeFiles = "delete from files where geek in (?)";
    const deleteSomeGeeks = "delete from geeks where username in (?)";
    const deleteOnePlays = "delete from plays where geek = ?";
    const deleteSomePlays = "delete from plays where geek in (?)";
    const deleteOneNormalisedPlays = "delete from plays_normalised where geek = ?";
    const deleteSomeNormalisedPlays = "delete from plays_normalised where geek in (?)";
    const deleteOneWarTable = "delete from war_table where geek = ?";
    const deleteSomeWarTable = "delete from war_table where geek in (?)";
    if (extraUsers.length === 1) {
        await conn.query(deleteOneWarTable, extraUsers);
        await conn.query(deleteOnePlays, extraUsers);
        await conn.query(deleteOneNormalisedPlays, extraUsers);
        await conn.query(deleteOneFile, extraUsers);
        await conn.query(deleteOneGeek, extraUsers);
    } else if (extraUsers.length > 0) {
        await conn.query(deleteSomeWarTable, [extraUsers]);
        await conn.query(deleteSomePlays, [extraUsers]);
        await conn.query(deleteSomeNormalisedPlays, [extraUsers]);
        await conn.query(deleteSomeFiles, [extraUsers]);
        await conn.query(deleteSomeGeeks, [extraUsers]);
    }
}

async function doEnsureUser(conn: mysql.Connection, user: string) {
    const insertSql = "insert into geeks (username) values (?)";
    try {
        await conn.query(insertSql, [user]);
        console.log("added user " + user);
    } catch (e) {
        // user already there
        return;
    }
    const geekid = await getGeekId(conn, user);
    await doEnsureFileProcessUser(conn, user, geekid);
    await doEnsureFileProcessUserCollection(conn, user, geekid);
    await doEnsureFileProcessUserPlayed(conn, user, geekid);
}

export async function doUpdateGamesForGeek(conn: mysql.Connection, geek: string, games: CollectionGame[]) {
    const geekId = await getGeekId(conn, geek);
    const notExist = await getGamesThatDontExist(conn);
    for (const game of games) {
        if (notExist.indexOf(game.gameId) >= 0) continue;
        await doUpdateGeekgame(conn, geekId, game);
    }
}

async function doUpdateGeekgame(conn: mysql.Connection, geekId: number, game: CollectionGame) {
    const insertSql = "insert into geekgames (geekId, game, rating, owned, want, wish, trade, prevowned, wanttobuy, wanttoplay, preordered) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    const updateSql = "update geekgames set rating = ?, owned = ?, want = ?, wish = ?, trade = ?, prevowned = ?, wanttobuy = ?, wanttoplay = ?, preordered = ? where game = ? and geekid = ?";
    const updateResult = await conn.query(updateSql, [game.rating, game.owned, game.want, game.wishListPriority, game.forTrade, game.prevOwned,
        game.wantToBuy, game.wantToPlay, game.preordered, game.gameId, geekId]);
    if (updateResult["affectedRows"] === 0) {
        await conn.query(insertSql, [geekId, game.gameId, game.rating, game.owned, game.want, game.wishListPriority,
            game.forTrade, game.prevOwned, game.wantToBuy, game.wantToPlay, game.preordered]);
    }
}

export async function doEnsureProcessPlaysFiles(conn: mysql.Connection, geek: string, months: MonthPlayed[]) {
    const playsUrl = "https://boardgamegeek.com/xmlapi2/plays?username=%s&mindate=%d-%d-01&maxdate=%d-%d-31&subtype=boardgame".replace("%s", encodeURIComponent(geek));
    const timelessPlaysUrl = "https://boardgamegeek.com/xmlapi2/plays?username=%s&mindate=0000-00-00&maxdate=0000-00-00&subtype=boardgame".replace("%s", encodeURIComponent(geek));
    const geekId = await getGeekId(conn, geek);
    for (const month of months) {
        let url = playsUrl
            .replace("%d", month.year.toString())
            .replace("%d", month.month.toString())
            .replace("%d", month.year.toString())
            .replace("%d", month.month.toString());
        if (month.month === 0 && month.year === 0) url = timelessPlaysUrl;
        await doRecordFile(conn, url, "processPlays", geek, "Plays for " + geek + " for " + month.month + "/" + month.year,
            null, month.month, month.year, geekId);
    }
}

export async function doEnsureMonthsPlayed(conn: mysql.Connection, geek: string, months: MonthPlayed[]) {
    const geekId = await getGeekId(conn, geek);
    const insertSql = "insert into months_played (geek, month, year) values (?, ?, ?)";
    for (const month of months) {
        try {
            await conn.query(insertSql, [geekId, month.month, month.year]);
        } catch (e) {
            // ignore insert duplicate row
        }
    }
}

export async function doEnsureGames(conn: mysql.Connection, ids: number[]): Promise<number[]> {
    if (ids.length === 0) return;
    const sqlSome = "select bggid from files where bggid in (?) and processMethod = 'processGame'";
    const sqlOne = "select bggid from files where bggid = ? and processMethod = 'processGame'";
    let params;
    let sql;
    if (ids.length == 1) {
        sql = sqlOne;
        params = ids;
    } else {
        sql = sqlSome;
        params = [ids];
    }
    const found = (await conn.query(sql, params)).map(row => row.bggid);
    const notExist = await getGamesThatDontExist(conn);
    const uniques = Array.from(new Set(listMinus(listMinus(ids, found), notExist)));
    for (const id of uniques) {
        await doRecordGame(conn, id);
    }
    return listIntersect(ids, notExist);
}

async function doRecordGame(conn: mysql.Connection, bggid: number) {
    const GAME_URL = "https://boardgamegeek.com/xmlapi/boardgame/%d&stats=1";
    const url = GAME_URL.replace("%d", bggid.toString());
    const insertSql = "insert into files (url, processMethod, geek, lastupdate, tillNextUpdate, description, bggid) values (?, ?, ?, ?, ?, ?, ?)";
    const tillNext = tillNextUpdate("processGame");
    const insertParams = [url, "processGame", null, null, tillNext, "Game #" + bggid, bggid];
    await conn.query(insertSql, insertParams).catch(err => {});
}


async function doRecordFile(conn: mysql.Connection, url: string, processMethod: string, user: string | null, description: string,
                            bggid: number | null, month: number | null, year: number | null, geekid: number | null) {
    const countSql = "select count(*) from files where url = ? and processMethod = ?";
    const insertSql = "insert into files (url, processMethod, geek, lastupdate, tillNextUpdate, description, bggid, month, year, geekid) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    const found = await count(conn, countSql, [url, processMethod]);
    if (found === 0) {
        const tillNext = tillNextUpdate(processMethod);
        const insertParams = [url, processMethod, user, null, tillNext, description, bggid, month, year, geekid];
        await conn.query(insertSql, insertParams).catch(err => {});
    }
}

async function doEnsureFileProcessUser(conn: mysql.Connection, geek: string, geekid: number) {
    const url = `https://boardgamegeek.com/user/${geek}`;
    await doRecordFile(conn, url, "processUser", geek, "User's profile", null, null, null, geekid);
}

async function doEnsureFileProcessUserCollection(conn: mysql.Connection, geek: string, geekid: number) {
    const url = `https://boardgamegeek.com/xmlapi2/collection?username=${geek}&brief=1&stats=1`;
    await doRecordFile(conn, url, "processCollection", geek, "User collection - owned, ratings, etc", null, null, null, geekid);
}

async function doEnsureFileProcessUserPlayed(conn: mysql.Connection, geek: string, geekid: number) {
    const url = `https://boardgamegeek.com/plays/bymonth/user/${geek}/subtype/boardgame`;
    await doRecordFile(conn, url, "processPlayed", geek, "Months in which user has played games", null, null, null, geekid);
}

export async function doListToProcess(conn: mysql.Connection, count: number, processMethod: string, updateLastScheduled: boolean): Promise<ToProcessElement[]> {
    let query: ToProcessElement[];
    if (processMethod) {
        query = await doListToProcessByMethod(conn, count, processMethod);
    } else {
        query = await doListToProcessAll(conn, count);
    }
    if (updateLastScheduled) {
        const urls = query.map(element => element.url);
        await doUpdateLastScheduledForUrls(conn, urls);
    }
    return query;
}

async function doListToProcessAll(conn: mysql.Connection, count: number): Promise<ToProcessElement[]> {
    const sql = "select * from files where (lastUpdate is null || (nextUpdate is not null && nextUpdate < now())) and (last_scheduled is null || TIMESTAMPDIFF(MINUTE, last_scheduled, now()) >= 10) limit ?";
    return (await conn.query(sql, [count])).map(row => row as ToProcessElement);
}

async function doListToProcessByMethod(conn: mysql.Connection, count: number, processMethod: string): Promise<ToProcessElement[]> {
    const sql = "select * from files where processMethod = ? and (lastUpdate is null || (nextUpdate is not null && nextUpdate < now())) and (last_scheduled is null || TIMESTAMPDIFF(MINUTE, last_scheduled, now()) >= 15) limit ?";
    return (await conn.query(sql, [processMethod, count])).map(row => row as ToProcessElement);
}

async function doUpdateLastScheduledForUrls(conn: mysql.Connection, urls: string[]) {
    const sqlOne = "update files set last_scheduled = now() where url = ?";
    const sqlMany = "update files set last_scheduled = now() where url in (?)";
    if (urls.length == 0) {
        return;
    } else if (urls.length == 1) {
        await conn.query(sqlOne, urls);
    } else {
        await conn.query(sqlMany, [urls]);
    }
}

export async function doGatherPlaysDataForWarTable(conn: mysql.Connection, geekId: number): Promise<{
    totalPlays: number, distinctGames: number, tens: number, zeros: number, hindex: number, sdj: number, ext100: number }> {
    const distinctGameSql = "select count(distinct game) c from plays_normalised where geek = ?";
    const totalPlaysSql = "select sum(quantity) s from plays_normalised where geek = ? and baseplay is null";
    const tensSql = "select count(plays.g) t from (select game g, sum(quantity) q from plays_normalised where geek = ? group by game) plays, geekgames where geekgames.geekid = ? and geekgames.game = plays.g and geekgames.owned > 0 and plays.q >= 10";
    const zerosSql = "select count(game) z from geekgames where geekid = ? and owned > 0 and game not in (select game from plays_normalised where geek = ?)";
    const hindexSql = "select sum(quantity) q from plays_normalised where geek = ? and expansion_play = 0 group by game order by q desc";
    const seriesPlaysSql = "select count(distinct series.game) c from plays_normalised,series where series.series_id = ? and series.game = plays_normalised.game and plays_normalised.geek = ?";
    const distinctGames = (await conn.query(distinctGameSql, [geekId]))[0]["c"];
    const totalPlays = (await conn.query(totalPlaysSql, [geekId]))[0]["s"];
    const tens = (await conn.query(tensSql, [geekId, geekId]))[0]["t"];
    const zeros = (await conn.query(zerosSql, [geekId, geekId]))[0]["z"];
    const hindexData = (await conn.query(hindexSql, [geekId])).map(row => row["q"]);
    let hindex = 0;
    while (hindexData.length > hindex && hindexData[hindex] > hindex) hindex++;
    const sdjId = await getIdForSeries(conn, "Spiel des Jahre");
    const sdj = (await conn.query(seriesPlaysSql, [sdjId, geekId]))[0]["c"];
    const ext100Id = await getIdForSeries(conn, "Extended Stats Top 100");
    const ext100 = (await conn.query(seriesPlaysSql, [ext100Id, geekId]))[0]["c"];
    // TODO
    return { totalPlays, distinctGames, tens, zeros, hindex, sdj, ext100 };
}

async function doUpdateFrontPageGeek(conn: mysql.Connection, geekName: string) {
    const geekId = await getGeekId(conn, geekName);
    const owned = await countWhere(conn, "geekgames where geekId = ? and owned > 0", [geekId]);
    const want = await countWhere(conn, "geekgames where geekId = ? and want > 0", [geekId]);
    const wish = await countWhere(conn, "geekgames where geekId = ? and wish > 0", [geekId]);
    const trade = await countWhere(conn, "geekgames where geekId = ? and trade > 0", [geekId]);
    const prevOwned = await countWhere(conn, "geekgames where geekId = ? and prevowned > 0", [geekId]);
    const preordered = await countWhere(conn, "geekgames where geekId = ? and preordered > 0", [geekId]);
    const playsDataForWarTable = await doGatherPlaysDataForWarTable(conn, geekId);
    const fpg: WarTableRow = {
        geek: geekId,
        geekName: geekName,
        totalPlays: playsDataForWarTable.totalPlays,
        distinctGames: playsDataForWarTable.distinctGames,
        top50: 0, // TODO
        sdj: playsDataForWarTable.sdj,
        owned: owned,
        want: want,
        wish: wish,
        trade: trade,
        prevOwned: prevOwned,
        friendless: 0, // TODO
        cfm: 0.0, // TODO
        utilisation: 0.0, // TODO
        tens: playsDataForWarTable.tens,
        zeros: playsDataForWarTable.zeros,
        ext100: playsDataForWarTable.ext100,
        hindex: playsDataForWarTable.hindex,
        preordered: preordered
    };
    const insertSql = "insert into war_table (geek, geekName, totalPlays, distinctGames, top50, sdj, owned, want, wish, " +
        "trade, prevOwned, friendless, cfm, utilisation, tens, zeros, ext100, hindex, preordered) values " +
        "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    const updateSql = "update war_table set geekName = ?, totalPlays = ?, distinctGames = ?, top50 = ?, sdj = ?, owned = ?, "
        + "want = ?, wish = ?, trade = ?, prevOwned = ?, friendless = ?, cfm = ?, utilisation = ?, tens = ?, zeros = ?, "
        + "ext100 = ?, hindex = ?, preordered = ? where geek = ?";
    try {
        await conn.query(insertSql, [fpg.geek, fpg.geekName, fpg.totalPlays, fpg.distinctGames, fpg.top50, fpg.sdj, fpg.owned,
            fpg.want, fpg.wish, fpg.trade, fpg.prevOwned, fpg.friendless, fpg.cfm, fpg.utilisation, fpg.tens, fpg.zeros,
            fpg.ext100, fpg.hindex, fpg.preordered]);
    } catch (e) {
        await conn.query(updateSql, [fpg.geekName, fpg.totalPlays, fpg.distinctGames, fpg.top50, fpg.sdj, fpg.owned,
            fpg.want, fpg.wish, fpg.trade, fpg.prevOwned, fpg.friendless, fpg.cfm, fpg.utilisation, fpg.tens, fpg.zeros,
            fpg.ext100, fpg.hindex, fpg.preordered, fpg.geek]);
    }
}

export async function doNormalisePlaysForMonth(conn: mysql.Connection, geekId: number, month: number, year: number, expansionData: ExpansionData) {
    const selectSql = "select game, playDate, quantity from plays where geek = ? and month = ? and year = ?";
    const deleteSql = "delete from plays_normalised where geek = ? and month = ? and year = ?";
    const insertBasePlaySql = "insert into plays_normalised (game, geek, quantity, year, month, date, expansion_play) values ?";
    const getIdSql = "select id from plays_normalised where game = ? and geek = ? and quantity = ? and year = ? and month = ? and date = ? and expansion_play = 0";
    const insertExpansionPlaySql = "insert into plays_normalised (game, geek, quantity, year, month, date, expansion_play, baseplay) values ?";
    const rows = await conn.query(selectSql, [geekId, month, year]);
    const rawData = rows.map(row => extractNormalisedPlayFromPlayRow(row, geekId, month, year));
    const byDate = _.groupBy(rawData, playDate);
    const allPlays = _.flatMap(Object.values(byDate).map(plays => inferExtraPlays(plays as NormalisedPlays[], expansionData))) as WorkingNormalisedPlays[];
    await conn.query(deleteSql, [geekId, month, year]);
    // insert all of the base plays
    const basePlays = [];
    for (let np of allPlays) {
        basePlays.push([np.game, geekId, np.quantity, np.year, np.month, np.date, 0]);
    }
    if (basePlays.length > 0) {
        await conn.query(insertBasePlaySql, [basePlays]);
    }
    // construct the expansion plays with references to the base plays
    const expPlays = [];
    for (let np of allPlays) {
        if (np.expansions.length > 0) {
            const id = (await conn.query(getIdSql, [np.game, geekId, np.quantity, np.year, np.month, np.date]))[0].id;
            for (let e of np.expansions) {
                expPlays.push([e, geekId, np.quantity, np.year, np.month, np.date, 1, id]);
            }
        }
    }
    if (expPlays.length > 0) {
        await conn.query(insertExpansionPlaySql, [expPlays]);
    }
}

export async function doSetGeekPlaysForMonth(conn: mysql.Connection, geekId: number, month: number, year: number,
                                             plays: PlayData[], notGames: number[]) {
    const deleteSql = "delete from plays where geek = ? and month = ? and year = ?";
    const insertSql = "insert into plays (game, geek, playDate, quantity, raters, ratingsTotal, location, month, year) values ?";
    const playsAlready = await countWhere(conn, "plays where geek = ? and month = ? and year = ?", [geekId, month, year]);
    if (playsAlready > 0 && plays.length === 0) {
        console.log("Not updating plays for " + geekId + " " + month + "/" + year + " because there are existing plays and none to replace them.");
        return;
    }
    await conn.query(deleteSql, [geekId, month, year]);
    const values = [];
    for (const play of plays) {
        if (notGames.indexOf(play.gameid) >= 0) continue;
        values.push([play.gameid, geekId, play.date, play.quantity, play.raters, play.ratingsTotal, play.location, month, year]);
    }
    if (values.length > 0) {
        await conn.query(insertSql, [values]);
    }
}

export async function doUpdateRankings(conn: mysql.Connection) {
    // calculate extended stats top 100
    const ext100Sql = "select game from ranking_table order by ranking_table.total_ratings desc limit 100";
    const top100Games = (await conn.query(ext100Sql)).map(row => row["game"]);
    await doUpdateSeries(conn, [ { name: "Extended Stats Top 100", games: top100Games } as SeriesMetadata ]);

    // calculate normalised rankings
    // TODO
}

async function getGeekId(conn: mysql.Connection, geek: string): Promise<number> {
    const getIdSql = "select id from geeks where geeks.username = ?";
    return (await conn.query(getIdSql, [geek]))[0]['id'];
}

async function countWhere(conn: mysql.Connection, where: string, params: any[]) {
    const sql = "select count(*) from " + where;
    const result = await conn.query(sql, params);
    return result[0]["count(*)"];
}

async function getGamesThatDontExist(conn: mysql.Connection): Promise<number[]> {
    const sql = "select bggid from not_games";
    return (await conn.query(sql)).map(row => row.bggid);
}

async function getIdForSeries(conn: mysql.Connection, seriesName: string): Promise<number> {
    const sql = "select id from series_metadata where name = ?";
    return (await conn.query(sql, [seriesName]))[0]["id"];
}

async function loadExpansionData(conn: mysql.Connection): Promise<ExpansionData> {
    return new ExpansionData(await conn.query("select basegame, expansion from expansions"));
}

export async function doProcessPlayedMonths(conn: mysql.Connection, geek: string, months: MonthPlayed[], url: string) {
    await doEnsureMonthsPlayed(conn, geek, months);
    await doEnsureProcessPlaysFiles(conn, geek, months);
    await doMarkUrlProcessed(conn, "processPlayed", url);
}

export async function doProcessPlaysResult(conn: mysql.Connection, data: ProcessPlaysResult) {
    const gameIds = [];
    for (const play of data.plays) {
        if (gameIds.indexOf(play.gameid) < 0) gameIds.push(play.gameid);
    }
    const geekId = await getGeekId(conn, data.geek);
    const expansionData = await loadExpansionData(conn);
    const notGames = await doEnsureGames(conn, gameIds);
    await doSetGeekPlaysForMonth(conn, geekId, data.month, data.year, data.plays, notGames);
    await doNormalisePlaysForMonth(conn, geekId, data.month, data.year, expansionData);
    const now = new Date();
    const nowMonth = now.getFullYear() * 12 + now.getMonth();
    const thenMonth = data.year * 12 + data.month;
    let delta;
    if (nowMonth - thenMonth > 6) {
        delta = '838:00:00';
    } else if (nowMonth - thenMonth > 2) {
        delta = '168:00:00';
    } else {
        delta = '72:00:00';
    }
    await doMarkUrlProcessedWithUpdate(conn, "processPlays", data.url, delta);
}
