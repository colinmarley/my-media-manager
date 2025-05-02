## Summary
Here’s how you can create a page to display your media collection (Movies and TV Series) in a grid system using Material-UI (MUI). I'll also outline which fields should be displayed in the Tile and which should be shown in a Popover Modal.

## Fields to Display in Media Tile

### Tile (Movie/Series Card)

1. **Poster**: omdbData.Poster
2. **Title**: title
3. **Year(s)**:  
    - *For Movies*: releaseDate
    - *For Series*: runningDates
4. **Type Indicator**: Add a badge or label to differentiate between 
Movies and Series.

## Popover Modal

1. **Poster**: omdbData.Poster
2. **Title**: title
3. **Year(s)**:
    - *For Movies*: releaseDate
    - *For Series*: runningDates
4. **Country of Origin**: countryOfOrigin
5. **Directors**: directors
6. **Runtime**: runtime
7. **Genres**: genres
8. **Top Cast**: topCast
9. **Writers**: writers
10. **Plex Link**: plexLink
11. **Letterboxd Link**: letterboxdLink

