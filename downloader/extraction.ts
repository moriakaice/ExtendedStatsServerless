import {ProcessUserResult, ProcessCollectionResult, CollectionGame} from "./interfaces";
import {between} from "./library";
const xml2js = require('xml2js-es6-promise');

export function extractUserCollectionFromPage(geek: string, url: string, pageContent: string): ProcessCollectionResult {
    return xml2js(pageContent, {trim: true})
        .then(dom => {
            if (!dom || !dom.items || dom.items.item.length == 0) {
                throw new Error("Found no games in collection for " + geek);
            }
            const items = [];
            dom.items.item.forEach(item => {
                if (item.$.subtype != 'boardgame') {
                    console.log(item.$.subtype + " not a board game");
                } else {
                    const gameId = item.$.objectid;
                    const name = item.name[0]._;
                    const stats = item.stats[0];
                    const status = item.status[0];
                    const gameItem = { name: name, gameId: gameId } as CollectionGame;
                    if (stats) {
                        const rating = stats.rating;
                        // 2018-06-18T22:24:58.331Z	6b8e68a6-7346-11e8-87e6-1f927414bfa6	[ { '$': { value: '6' },
                        //     average: [ [Object] ],
                        //     bayesaverage: [ [Object] ] } ]
                        if (rating && rating.length > 0) {
                            gameItem.rating = parseFloat(rating[0].$.value);
                        } else {
                            gameItem.rating = -1;
                        }
                        if (gameItem.rating == null || Number.isNaN(gameItem.rating)) gameItem.rating = -1;
                    }
                    // 2018-06-18T21:37:27.269Z	c7f472a7-733f-11e8-9e07-831994274964	{ '$':
                    //     { own: '0',
                    //         prevowned: '0',
                    //         fortrade: '0',
                    //         want: '0',
                    //         wanttoplay: '0',
                    //         wanttobuy: '0',
                    //         wishlist: '1',
                    //         wishlistpriority: '5',
                    //         preordered: '0',
                    //         lastmodified: '2013-03-19 06:59:47' } }
                    if (status) {
                        gameItem.own = status.$.own === '1';
                        gameItem.forTrade = status.$.prevowned === '1';
                        gameItem.want = status.$.want === '1';
                        gameItem.wantToPlay = status.$.wanttoplay === '1';
                        gameItem.wantToBuy = status.$.wanttobuy;
                        const onWishList =  status.$.wishlist === '1';
                        gameItem.wishListPriority = onWishList ? parseInt(status.$.wishlist) : 0;
                        gameItem.preordered = status.$.preordered === '1';
                    }
                    // haven't found this in the parsed XML yet
                    gameItem.description = "";
                    // console.log(gameItem);
                    items.push(gameItem);
                }
            });
            console.log("" + items.length + " items");
            return { geek: geek, items: items };
        });
}

// def processCollection(db, filename, geek, url):
// import logging
// try:
// dom = xml.dom.minidom.parse(filename)
// except xml.parsers.expat.ExpatError, e:
// logging.exception(str(e))
// return 0
// if len(dom.getElementsByTagName("items")) == 0:
// logging.warning("no items in %s" % filename)
// return 0
// db.execute("delete from geekgames where geek = '%s'" % geek)
// addGamesFromFile(db, dom, geek)
// import frontpage
// frontpage.updateFrontPageData(db, geek)
// return 1

// def addGamesFromFile(db, dom, geek):
// import downloaderdb, library
// owned = {}
// if len(dom.getElementsByTagName("items")) == 0:
// return 0
// games = dom.getElementsByTagName("items")[0]
// gameNodes = games.getElementsByTagName("item")
// for gameNode in gameNodes:
// statusNode = gameNode.getElementsByTagName("status")[0]
// statsNode = gameNode.getElementsByTagName("stats")[0]
// try:
// g = int(gameNode.getAttribute("objectid"))
// except AttributeError:
//     continue
// if owned.get(g) is not None:
//     game = owned[g]
// else:
// game = downloaderdb.Row()
// game.game = g
// game.owned = False
// game.prevowned = False
// game.wanttobuy = False
// game.wanttoplay = False
// game.preordered = False
// game.rating = -1
// game.owned = game.owned or int(statusNode.getAttribute("own"))
// game.prevowned = game.prevowned or int(statusNode.getAttribute("prevowned"))
// game.wanttobuy = game.wanttobuy or int(statusNode.getAttribute("wanttobuy"))
// game.wanttoplay = game.wanttoplay or int(statusNode.getAttribute("wanttoplay"))
// game.preordered = game.preordered or int(statusNode.getAttribute("preordered"))
// game.geek = geek
// try:
// ratingNode = statsNode.getElementsByTagName("rating")[0]
// game.rating = max(float(ratingNode.getAttribute("value")), game.rating)
// except ValueError:
//     game.rating = -1.0
// if game.rating == 0.0:
// game.rating = -1.0
// comments = gameNode.getElementsByTagName("comment")
// if len(comments) > 0:
// game.comment = library.getText(comments[0])
// else:
// game.comment = "&nbsp;"
// if len(game.comment) > 1024:
// game.comment = game.comment[:1024]
// game.wish = statusNode.getAttribute("wishlistpriority")
// if game.wish == "":
// game.wish = "0"
// game.want = statusNode.getAttribute("want")
// if game.want == "":
// game.want = "0"
// game.trade = statusNode.getAttribute("fortrade")
// if game.trade == "":
// game.trade = "0"
// if game.owned:
// owned[game.game] = game
// ensureGame(db, game.game)
// existingRating = getExistingRating(db, geek, game.game)
// if existingRating is not None and existingRating > game.rating:
// game.rating = existingRating
// db.saveRow(game, "geekgames", "geek = '%s' and game = %d" % (geek, game.game))
// db.execute("delete from geekgametags where geek = '%s'" % geek)
// try:
// tagsNode = gameNode.getElementsByTagName("tags")[0]
// tagNodes = tagsNode.getElementsByTagName("tag")
// for tagNode in tagNodes:
// tag = library.Row()
// tag.geek = geek
// tag.game = game.game
// tag.tag = library.getText(tagNode).encode('utf8')
// if tag.tag.startswith("own:"):
// continue
// db.saveRow(tag, "geekgametags", "geek = '%s' and game = %d" % (tag.geek, tag.game))
// except IndexError:
//     # no tags
// pass


export function extractUserDataFromPage(geek: string, url: string, pageContent: string): ProcessUserResult {
    const BEFORE_USER_IMAGE = "/images/user/";
    const BEFORE_COUNTRY = "/users?country=";
    const AFTER_USER_IMAGE = "/";
    const AFTER_COUNTRY = '"';

    let bggid = -1;
    let country = "";
    if (pageContent.indexOf(BEFORE_USER_IMAGE) >= 0) {
        const bggids = between(pageContent, BEFORE_USER_IMAGE, AFTER_USER_IMAGE);
        if (bggids) bggid = parseInt(bggids);
    }
    if (pageContent.indexOf(BEFORE_COUNTRY) >= 0) {
        country = between(pageContent, BEFORE_COUNTRY, AFTER_COUNTRY).replace("%20", " ");
    }
    const result: ProcessUserResult = {
        geek: geek,
        url: url,
        country: country,
        bggid: bggid
    };
    return result;
}
