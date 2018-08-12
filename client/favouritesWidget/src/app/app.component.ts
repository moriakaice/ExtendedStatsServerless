import {AfterViewInit, Component, OnDestroy} from '@angular/core';
import {fromExtStatsStorage} from "./extstats-storage";
import {CollectionWithPlays, GameData, GamePlays, GeekGameQuery} from "./collection-interfaces";
import {HttpClient, HttpHeaders} from "@angular/common/http";
import {Subscription} from "rxjs/internal/Subscription";
import {FavouritesRow} from "./interfaces";
import {ChartDefinition, ChartSet} from "./charts";

@Component({
  selector: 'extstats-favourites',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class FavouritesComponent implements OnDestroy, AfterViewInit {
  private readonly geek: string;
  private loadData$;
  public data: CollectionWithPlays;
  public rows: FavouritesRow[];
  private subscription: Subscription;
  public docCollapsed = true;
  public chartsCollapsed = true;
  public chartSet = new ChartSet();

  constructor(private http: HttpClient) {
    this.geek = fromExtStatsStorage(storage => storage.geek);
    this.chartSet.add(new ChartDefinition("avgVsRating", "Average vs Rating", "point", FavouritesComponent.extractAvgVsRating));
    this.chartSet.add(new ChartDefinition("ratingVsPlays", "Rating vs Plays", "circle", FavouritesComponent.extractRatingVsPlays));
    this.chartSet.add(new ChartDefinition("ratingVsMonths", "Rating vs Distinct Months", "circle", FavouritesComponent.extractRatingVsMonths));
  }

  private static extractAvgVsRating(data: CollectionWithPlays): object {
    const values = [];
    const averageByGame = {};
    for (const gd of data.games) {
      averageByGame[gd.bggid] = gd.bggRating;
    }
    for (const gg of data.collection) {
      if (gg.rating > 0 && averageByGame[gg.bggid]) {
        values.push({ x: gg.rating, y: averageByGame[gg.bggid] });
      }
    }
    return { values };
  }

  private static extractRatingVsPlays(data: CollectionWithPlays): object {
    const values = [];
    const playsByGame = {};
    for (const gp of data.plays) {
      playsByGame[gp.game] = gp.plays;
    }
    for (const gg of data.collection) {
      if (gg.rating > 0) {
        const plays = playsByGame[gg.bggid] || 0;
        values.push({ x: gg.rating, y: plays });
      }
    }
    return { values };
  }

  private static extractRatingVsMonths(data: CollectionWithPlays): object {
    const values = [];
    const monthsByGame = {};
    for (const gp of data.plays) {
      monthsByGame[gp.game] = gp.distinctMonths;
    }
    for (const gg of data.collection) {
      if (gg.rating > 0) {
        const plays = monthsByGame[gg.bggid] || 0;
        values.push({ x: gg.rating, y: plays });
      }
    }
    return { values };
  }

  public ngAfterViewInit(): void {
    if (!this.geek) return;
    const options = {
      headers: new HttpHeaders().set("x-api-key", "gb0l7zXSq47Aks7YHnGeEafZbIzgmGBv5FouoRjJ")
    };
    const body: GeekGameQuery = {
      query: "all(played(ME), rated(ME))",
      geek: this.geek
    };
    console.log(body);
    this.loadData$ = this.http.post("https://api.drfriendless.com/v1/collectionWithPlays", body, options);
    this.subscription = this.loadData$.subscribe(result => {
      this.data = result;
      console.log(this.data);
      this.rows = FavouritesComponent.makeRows(this.data);
    })
  }

  public toggle(name: string) {
    if ("doc" === name) {
      this.docCollapsed = !this.docCollapsed;
      if (!this.docCollapsed) this.chartsCollapsed = true;
    } else if ("charts" === name) {
      this.chartsCollapsed = !this.chartsCollapsed;
      if (!this.chartsCollapsed) this.docCollapsed = true;
    }
  }

  private static makeRows(data: CollectionWithPlays): FavouritesRow[] {
    const HUBER_BASELINE = 4.5;
    const collection = data.collection;
    const playsIndex = FavouritesComponent.makePlaysIndex(data.plays);
    const gamesIndex = FavouritesComponent.makeGamesIndex(data.games);
    const lastYearIndex = FavouritesComponent.makePlaysIndex(data.lastYearPlays);
    const rows = [] as FavouritesRow[];
    collection.forEach(gg => {
      if (!gg.rating) gg.rating = undefined;
      const gp = playsIndex[gg.bggid] || { plays: 0, expansion: false, game: gg.bggid, distinctMonths: 0, distinctYears: 0 } as GamePlays;
      const ly = lastYearIndex[gg.bggid] || { plays: 0, expansion: false, game: gg.bggid, distinctMonths: 0, distinctYears: 0 } as GamePlays;
      const game = gamesIndex[gg.bggid] || { name: "Unknown", bggRanking: 1000000, bggRating: 1.0 } as GameData;
      const hoursPlayed = gp.plays * game.playTime / 60;
      const friendlessHappiness = (!gg.rating) ? undefined : Math.floor((gg.rating * 5 + gp.plays + gp.distinctMonths * 4 + hoursPlayed) * 10) / 10;
      const huberHappiness = (!gg.rating) ? undefined : Math.floor((gg.rating - HUBER_BASELINE) * hoursPlayed);
      let huberHeat = undefined;
      if (gp.plays > 0 && gg.rating) {
        const s = 1 + ly.plays / gp.plays;
        const lyHours = ly.plays * game.playTime / 60;
        const lyHappiness = (gg.rating - HUBER_BASELINE) * lyHours;
        huberHeat = s * s * Math.sqrt(ly.plays) * lyHappiness;
        huberHeat = Math.floor(huberHeat * 10) / 10;
      }
      let ruhm = 0;
      if (gp.distinctMonths > 0 && gg.rating) {
        const firstDate = FavouritesComponent.intToDate(gp.firstPlay);
        const lastDate = FavouritesComponent.intToDate(gp.lastPlay);
        const flash = FavouritesComponent.daysBetween(lastDate, firstDate);
        const lag = FavouritesComponent.daysBetween(new Date(), lastDate);
        const flmr = flash / lag * gp.distinctMonths * gg.rating;
        const log = (flmr < 1) ? 0 : Math.log(flmr);
        ruhm = Math.round(log * 100) / 100;
      }
      const row = { gameName: game.name, game: gg.bggid, rating: gg.rating, plays: gp.plays, bggRanking: game.bggRanking,
        bggRating: game.bggRating, firstPlayed: FavouritesComponent.toDateString(gp.firstPlay),
        lastPlayed: FavouritesComponent.toDateString(gp.lastPlay), monthsPlayed: gp.distinctMonths, yearsPlayed: gp.distinctYears,
        yearPublished: game.yearPublished, fhm: friendlessHappiness, hhm: huberHappiness, huberHeat,
        hoursPlayed: Math.floor(hoursPlayed), ruhm } as FavouritesRow;
      rows.push(row);
    });
    return rows;
  }

  private static toDateString(date: number): string {
    if (!date) return "";
    const y = Math.floor(date/10000);
    const m = Math.floor(date/100) % 100;
    const d = date % 100;
    const mm = (m < 10) ? "0" + m.toString() : m.toString();
    const dd = (d < 10) ? "0" + d.toString() : d.toString();
    return y.toString() + "-" + mm + "-" + dd;
  }

  private static makeGamesIndex(games: GameData[]): object {
    const result = {};
    games.forEach(gd => {
      result[gd.bggid] = gd;
    });
    return result;
  }

  private static makePlaysIndex(plays: GamePlays[]): object {
    const result = {};
    plays.forEach(gp => {
      result[gp.game] = gp;
    });
    return result;
  }

  public ngOnDestroy(): void {
    if (this.subscription) this.subscription.unsubscribe();
  }

  private static intToDate(date: number): Date | undefined {
    if (!date) return undefined;
    const y = Math.floor(date/10000);
    const m = Math.floor(date/100) % 100;
    const d = date % 100;
    return new Date(y, m, d);
  }

  // https://stackoverflow.com/questions/2627473/how-to-calculate-the-number-of-days-between-two-dates
  private static daysBetween(date1: Date, date2: Date) {
    // The number of milliseconds in one day
    const ONE_DAY = 1000 * 60 * 60 * 24;
    // Convert both dates to milliseconds
    const date1Ms = date1.getTime();
    const date2Ms = date2.getTime();
    // Calculate the difference in milliseconds
    const difference_ms = Math.abs(date1Ms - date2Ms);
    // Convert back to days and return
    return Math.round(difference_ms/ONE_DAY);
  }
}
