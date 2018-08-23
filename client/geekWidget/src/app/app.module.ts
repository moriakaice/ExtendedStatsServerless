import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import {HttpClientModule} from "@angular/common/http";
import { GeekWidget } from './app.component';
import { FavouritesPanelComponent } from './favourites-panel/favourites-panel.component';
import { PlaysPanelComponent } from './plays-panel/plays-panel.component';
import { DetailedPlaysPanelComponent } from './detailed-plays-panel/detailed-plays-panel.component';
import { YearlyPanelComponent } from './yearly-panel/yearly-panel.component';
import { CollectionPanelComponent } from './collection-panel/collection-panel.component';

@NgModule({
  declarations: [
    GeekWidget,
    FavouritesPanelComponent,
    PlaysPanelComponent,
    DetailedPlaysPanelComponent,
    YearlyPanelComponent,
    CollectionPanelComponent
  ],
  imports: [
    BrowserModule, HttpClientModule
  ],
  providers: [],
  bootstrap: [GeekWidget]
})
export class AppModule { }