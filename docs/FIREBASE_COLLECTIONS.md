
Configuration of the firebase database setup for the **my-media-manager** application.

Github Repo: [my-media-manager](https://github.com/colinmarley/my-media-manager)
Firebase Project: [media-db](https://console.firebase.google.com/project/media-db-cc511/overview)

# DB Collections

- [Movie Collection](#movie-collection)
	- [Structure](#movie-data-structure)
- [Series Collection](#series-collection)
	- [Structure](#series-data-structure)
- [Season Collection](#season-collection)
	- [Structure](#season-collection-structure)
- [Episode Collection](#episode-collection)
	- [Structure](#episode-collection-structure)
- [Release Collection](#release-collection)
	- [Structure](#release-collection-structure)
- [Actor Collection](#actor-collection)
- [Director Collection](#director-collection)

## Movie Collection

The Movie collection [`movies`](https://console.firebase.google.com/project/media-db-cc511/firestore/databases/-default-/data/~2Fmovies)  in the Firebase Database section on Firebase is meant to hold information about individual Movies.  They aren't necessarily in my Library but just hold data about the movie. The data is a collection of data from the Online Movie Database (OMDB) and The Movie Database (TMDB). It doesn't necessarily contain data about a specific release (DVD, BluRay, VHS, etc.) but it holds more generalized data about the movie as a whole. 

### Movie Data Structure
The data in the collection is structured as follows:

- [id](#movie-id): \<**unique string**\>
- [title](#movie-title): \<**string**\>
- [countries](#movie-countries): \<**string\[\]**\>
- [directors](#movie-directors): \<**MovieDirector\[\]**\>
- [genres](#movie-genres): \<**string\[\]**\>
- [imageFiles](#movie-imagefiles): \<**ImageFile\[\]**\>
- [languages](#movie-languages): \<**sting\[\]**\>
- [letterboxdLink](#movie-letterboxdlink): \<**string**\>
- [plexLink](#movie-plexlink): \<**string**\>
- [releaseDate](#movie-releasedate):\<**string**\>
- [releases](#movie-releases):\<**Release\[\]**\>
- [runtime](#movie-runtime): \<**string**\>
- [cast](#movie-cast):\<**Actor\[\]**\>
- [writers](#movie-writers): \<**string\[\]**\>
- [omdbData](#movie-omdbdata): \<**OmdbData**\>
### Movie id

[Movie Collection](#movie-collection)
A \<**unique string**\> value automatically created by firebase when adding a new entry to the collection so I don't have to check for uniqueness each time.

**validation**
- id length = 20 alphanumeric characters
- id are not sequential

### Movie title

[Movie Collection](#movie-collection)
The \<**string**\> value of the title of the movie. Its original title in the case there are multiple titles or nicknames for the movie.

**validation**
- no max length
- not empty
### Movie countries

[Movie Collection](#movie-collection)
The \<**string\[\]**\> representing the country/countries where the film originated.
Because of the possibility of country name changes in the past or future no validation is necessary

**validation**
- N/A
### Movie directors

[Movie Collection](#movie-collection)
A \<**MovieDirector\[\]**\> of the director(s) involved in the movie.

- **MovieDirector** Object
	- **name**: A \<**string**\> of the Director's name
	- **title**: A \<**string**\> of the title of the director on this movie
	- **directorId**: A <**unique string**> of the id for the director in the **directors** Firebase collection

**validation**
- Check if the Director exists in the **directors** collection before adding a new entry in Firebase
	- If multiple directors with the same name use an identifier like "Director Name (1)"
- title should be one of the following
	- Director - if only one name
	- Co-Director - if multiple names in array
- name should not be blank
- id should not be blank, if so, add entry in directors collection first
### Movie genres

[Movie Collection](#movie-collection)
A \<**string\[\]**\> representing the genre(s) for the movie. The genres in the array should be one of the following Enums:
- Action
- Adventure
- Animation
- Biography
- Comedy
- Crime
- Drama
- Family
- Fantasy
- Film Noir
- History
- Horror
- Music
- Musical
- Mystery
- Romance
- Sci-Fi
- Sport
- Superhero
- Thriller
- War
- Western

**validation**
- Ensure each entry is one of the values above.
- At least one entry necessary
### Movie imageFiles

[Movie Collection](#movie-collection)
An \<**ImageFile\[\]**\> that contain info images for the movie posters, covers, or stills.  There isn't another images collection and all associated images will have to be managed in the collection they belong to. If deleted from this field in the firebase collection there will not be another way to undo the action. There will likely be a URL for poster image from the omdb response.
- **ImageFile** Object: 
	- **fileName**: The \<**string**\> of the URL Path where the image is stored
	- **fileSize**: A \<**string**\> of the file size of the image to be retrieved
	- **format**: A \<**string**\> of the file type for the image (ex. png, jpeg, jpg, etc.)
	- **resolution**: A \<**string**\> representing the aspect ratio or dimensions of the image

**validation**
- If the array is empty ensure a default missing poster image is displayed instead
- For each entry, ensure there is a `fileName` value
- Check that the units of the `fileSize` value are in bytes for more accuracy
- Ensure there is an entry in the format field, even if it's `Unknown` if true
- Eventually add a check to get the resolution by analyzing the image.
### Movie languages

[Movie Collection](#movie-collection)
The \<**sting\[\]**\> for the original language(s) the movie was filmed using.

**validation**
- Ensure that the array is one of the recognized languages
- Use a list from wikipedia for possible languages (or a library if one exists)
### Movie letterboxdLink

[Movie Collection](#movie-collection)
A \<**string**\> for the URL of the Letterboxd page for the movie. This should be used on a page where all of the movie information is displayed to provide links to popular social/streaming sites.

**validation**
- This is ok to be empty
- If an entry exists ensure it is in the format: `https://letterboxd.com/film/{movie-name}/`
### Movie plexLink

[Movie Collection](#movie-collection)
A \<**string**\> for the URL of the plex page for the movie. Helpful for adding the movie to a watchlist on the site.

**validation**
- This is ok to be empty
- If an entry exists ensure it is in the format: `https://watch.plex.tv/movie/{movie-name}/`
### Movie releaseDate

[Movie Collection](#movie-collection)
A \<**string**\> formatted from the date the Movie was originally released.

**validation**
- String should following this format: `DayAsNumber-Month-Year` (ex. `1-March-2018`)
### Movie releases

[Movie Collection](#movie-collection)
A \<**Release\[\]**\> for the known releases of the movie on physical media (DVD, BluRay, VHS, etc.) There can be multiple release entries for the same physical media type, but must differ in either name or year. the releaseName, releaseType, and year will all exist in the releases collection but are included here to make it easier to display without too many extra calls.
	- **Release** Object
		- **releaseId**: A \<**unique string**\> of the entry in the **releases** collection in the Firebase Database
		- **releaseType**: A \<**string**\> of the release type (DVD, BluRay, VHS, etc.)
		- **year**: A \<**string**\> of the year of the release
		- **releaseName**: A \<**string**\> for the title/name of the release (Director's Cut, Special Edition, etc.)

**validation**
- Must include a releaseID in each of the entries in the array and must be unique, which means a entry must exist in the releases Firebase collection prior to be added to this array
- releaseName must exist for each of the entries
- year must be a single year between 1850-{current year}
- releaseType must be one of the following:
	- DVD
	- BLURAY
	- VHS
	- HDDVD
	- BETA
	- PSP
	- BLURAY-3D
### Movie runtime

[Movie Collection](#movie-collection)
A \<**string**\> of the runtime of the movie when it was originally released. This should match the runtime shown on imdb if the value is unknown. This also may differ from a runtime of a director's cut or special edition.

**validation**
- should be in the format `{hours}:{minutes}:{seconds}`
- seconds value can default to `00` if it is unknown or not given.
### Movie cast

[Movie Collection](#movie-collection)
An \<**Actor\[\]**\> where the entries represent Actors in the movie.  All Actors included here should already have entries in the `actors` Firebase collection prior to being added here. An actor can be an actual actor, a voice, or even a cameo appearance.
	- **Actor** Object
		- **name**: A \<**string**\> of the Actor's full name
		- **actorId**: A \<**string**\> of the id for the actor in the **actors** Firebase collection
		- **characters**: A \<**string\[\]**\> of all of the Characters that the actor played or voiced.

**validation**
- The array can be empty
- Each entry needs an associated actorId for an entry in the `actors` collection prior to being added to this array
- The actorId should be a unique id of length 20
- the name should be the full name of the actor
- if the actor is known by multiple names they go by use the one in the actors collection entry.
- characters field doesn't need to contain an entry, but can also contain multiple entries if the actor had multiple roles in the movie.
### Movie writers

[Movie Collection](#movie-collection)
A \<**string\[\]**\> of the names of writers with credits in the movie

**validation**
- The string array can be empty
- Each entry, if they exist, should contain the full name of the writer.
- There should not be multiple entries with the same exact name.
### Movie omdbData

[Movie Collection](#movie-collection)
A \<**OmdbData**\> object containing all of the known information retrieved from the [[Online Movie Database (OMDB) | OMDB API]].
There should be no changes made to this object after it gets returned by the API. By saving the full response we can keep from reaching the daily limit for calls to OMDB API easier.

--------------
## Series Collection

The [series](https://console.firebase.google.com/project/media-db-cc511/firestore/databases/-default-/data/~2Fseries) collection is for holding data for TV Series information.  They aren't necessarily in my Library but just hold data about the movie. The data is a collection of data from the Online Movie Database (OMDB) and The Movie Database (TMDB). It doesn't necessarily contain data about a specific release (DVD, BluRay, VHS, etc.) but it hold more generalized data about the series as a whole. 

### Series Data Structure
The data in the collection is structured as follows:

- [id](#series-id): <**unique string**>
- [title](#series-title): <**string**>
- [countries](#series-countries): <**string\[\]**>
- [directors](#series-directors): <**Director\[\]**>
- [imageFiles](#series-imagefiles): <**ImageFile\[\]**>
- [plexLink](#series-plexlink): <**string**>
- [runningYears](#series-runningyears): <**string\[\]**>
- [releases](#series-releases): <**Release\[\]**>
- [cast](#series-cast): <**Actor\[\]**>
- [writers](#series-writers): <**string\[\]**>
- [seasons](#series-seasons): <**SeasonEntry\[\]**>
- [awards](#series-awards): <**string**>
- [genres](#series-genres): <**string\[\]**>
- [languages](#series-languages): <**string\[\]**>
- [notes](#series-notes): <**string**>
- [omdbData](#series-omdbdata): <**OmdbData**>

### Series id

[Series Collection](#series-collection)
A \<**unique string**\> value automatically created by firebase when adding a new entry to the collection so I don't have to check for uniqueness each time.

**validation**
- id length = 20 alphanumeric characters
- id are not sequential
### Series title

[Series Collection](#series-collection)
The \<**string**\> value of the title of the Series. Its original title in the case there are multiple titles or nicknames for the series.

**validation**
- no max length
- not empty
### Series countries

[Series Collection](#series-collection)
The \<**string\[\]**\> representing the country/countries where the Series originated.
Because of the possibility of country name changes in the past or future no validation is necessary

**validation**
- N/A
- If no country association is found, ensure the field exists with an empty array
### Series directors

[Series Collection](#series-collection)
A \<**SeriesDirector\[\]**\> of the director(s) involved in the movie.

- **SeriesDirector** Object
	- **name**: A \<**string**\> of the Director's name
	- **title**: A \<**string**\> of the title of the director on this Series
	- seasons: A <**string\[\]**> of the seasons the person Directed
	- **directorId**: A <**unique string**> of the id for the director in the **directors** Firebase collection

**validation**
- Check if the Director exists in the **directors** collection before adding a new entry in Firebase
	- If multiple directors with the same name use an identifier like "Director Name (1)"
	- If it exists already update the entry instead of creating a new one.
- title should be one of the following
	- Director - if only one name
	- Co-Director - if multiple names in array
- name should not be blank
- seasons array is optional, if no info use empty array
- id should not be blank, if so, add entry in directors collection first
### Series imageFiles

[Series Collection](#series-collection)
An \<**ImageFile\[\]**\> that contain info images for the Series posters, covers, or stills.  There isn't another images collection and all associated images will have to be managed in the collection they belong to. If deleted from this field in the firebase collection there will not be another way to undo the action. There will likely be a URL for poster image from the omdb response.
- **ImageFile** Object: 
	- **fileName**: The \<**string**\> of the URL Path where the image is stored
	- **fileSize**: A \<**string**\> of the file size of the image to be retrieved
	- **format**: A \<**string**\> of the file type for the image (ex. png, jpeg, jpg, etc.)
	- **resolution**: A \<**string**\> representing the aspect ratio or dimensions of the image

**validation**
- If the array is empty ensure a default missing poster image is displayed instead
- For each entry, ensure there is a `fileName` value
- Check that the units of the `fileSize` value are in bytes for more accuracy
- Ensure there is an entry in the format field, even if it's `Unknown` if no info
- Eventually add a check to get the resolution by analyzing the image metadata
### Series plexLink

[Series Collection](#series-collection)
A \<**string**\> for the URL of the plex page for the series. Helpful for adding the series to a watchlist on the site.

**validation**
- This is ok to be empty
- If an entry exists ensure it is in the format: `https://watch.plex.tv/show/{movie-name}/`
### Series runningYears

[Series Collection](#series-collection)
A <**string\[\]**> of the year that the series ran. It could be that there were certain years where the series was not developed and then picked back up again so the array allows for an entry for each year that there were new episode that came out.

**validation**
- Ensure that each entry is only a single year, 4 digits
### Series releases

[Series Collection](#series-collection)
A \<**Release\[\]**\> for the known releases of the Series on physical media (DVD, BluRay, VHS, etc.) There can be multiple release entries for the same physical media type, but must differ in either name or year. the releaseName, releaseType, and year will all exist in the releases collection but are included here to make it easier to display without too many extra calls.
	- **Release** Object
		- **releaseId**: A \<**unique string**\> of the entry in the **releases** collection in the Firebase Database
		- **releaseType**: A \<**string**\> of the release type (DVD, BluRay, VHS, etc.)
		- **year**: A \<**string**\> of the year of the release
		- **releaseName**: A \<**string**\> for the title/name of the release (Director's Cut, Special Edition, etc.)

**validation**
- Must include a releaseID in each of the entries in the array and must be unique, which means a entry must exist in the releases Firebase collection prior to be added to this array
- releaseName must exist for each of the entries
- year must be a single year between 1850-{current year}, not the year the series aired but the year the release was put out
- releaseType must be one of the following:
	- DVD
	- BLURAY
	- VHS
	- HDDVD
	- BETA
	- PSP
	- BLURAY-3D
### Series cast

[Series Collection](#series-collection)
An \<**Actor\[\]**\> where the entries represent Actors in the Series.  All Actors included here should already have entries in the `actors` Firebase collection prior to being added here. An actor can be an actual actor, a voice, or even a cameo appearance.
	- **Actor** Object
		- **name**: A \<**string**\> of the Actor's full name
		- **actorId**: A \<**string**\> of the id for the actor in the **actors** Firebase collection
		- **characters**: A \<**string\[\]**\> of all of the Characters that the actor played or voiced.

**validation**
- The array can be empty
- Each entry needs an associated actorId for an entry in the `actors` collection prior to being added to this array
- The actorId should be a unique id of length 20
- the name should be the full name of the actor
	- if the actor is known by multiple names they go by use the one in the actors collection entry.
- characters field doesn't need to contain an entry, but can also contain multiple entries if the actor had multiple roles in the series.
### Series writers

[Series Collection](#series-collection)
A \<**string\[\]**\> of the names of writers with credits in the series

**validation**
- The string array can be empty
- Each entry, if they exist, should contain the full name of the writer.
- There should not be multiple entries with the same exact name.
### Series seasons

[Series Collection](#series-collection)
A <**SeasonEntry\[\]**> to hold the ids for the Seasons from the seasons Firebase Collection

**validation**
- Check each of the ids in the array for uniqueness and length == 20
### Series awards

[Series Collection](#series-collection)
A <**string**> coming from the OmdbData Response saying a summary of the awards that the Series has received from various institutions.

**validation**
If no awards info is found default to and empty string.
### Series genres

[Series Collection](#series-collection)
A \<**string\[\]**\> representing the genre(s) for the series. The genres in the array should be one of the following Enums:
- **Action**
- **Adventure**
- **Animation**
- **Anthology**
- **Biography**
- **Comedy**
- **Crime**
- **Documentary**
- **Drama**
- **Family**
- **Fantasy**
- **Game Show**
- **History**
- **Horror**
- **Music**
- **Mystery**
- **Reality**
- **Romance**
- **Sci-Fi**
- **Sitcom**
- **Sport**
- **Superhero**
- **Talk Show**
- **Teen**
- **Thriller**
- **War**
- **Western**

**validation**
- Ensure each entry is one of the values above.
- At least one entry necessary
### Series languages

[Series Collection](#series-collection)
The \<**sting\[\]**\> for the original language(s) series movie was filmed using.

**validation**
- Ensure that the array is one of the recognized languages
- Use a list from wikipedia for possible languages (or a library if one exists)
### Series notes

[Series Collection](#series-collection)
A <**string**> to hold any information for the Series that doesn't fit into one of the other field yet.

**validation**
- Ensure the value is a string. No other validation needed.
### Series omdbData

[Series Collection](#series-collection)
A \<**OmdbData**\> object containing all of the known information for the series retrieved from the [[Online Movie Database (OMDB) | OMDB API]].
There should be no changes made to this object after it gets returned by the API. By saving the full response we can keep from reaching the daily limit for calls to OMDB API easier.

## Season Collection

The Season Collection holds data for a single season of a Series in the series collection. For series with volumes instead of seasons that data will also be held here. It will have both the id of the series it's a part of and an array of the episodes that are a part of this season. Individual episode information will be held in the Episode Collection in firebase.

### Season Collection Structure

- [id](#season-id): <**unique string**>
- [title](#season-title): <**string**>
- [seriesId](#season-seriesId): <**string**>
- [number](#season-number): <**string**>
- [countries](#season-countries): <**string\[\]**>
- [directors](#season-directors): <**Director\[\]**>
- [imageFiles](#season-imageFiles): <**ImageFile\[\]**>
- [plexLink](#season-plexLink): <**string**>
- [releaseYear](#season-releaseYear): <**string**>
- [releases](#season-releases): <**string\[\]**>
- [cast](#season-cast): <**Actor\[\]**>
- [writers](#season-writers): <**string\[\]**>
- [episodes](#season-episodes): <**EpisodeData\[\]**>
- [languages](#season-languages): <**string\[\]**>
- [omdbData](#season-omdbData): <**OmdbData**>

### Season id

[Season Collection](#season-collection)
A \<**unique string**\> value automatically created by firebase when adding a new entry to the collection so I don't have to check for uniqueness each time.

**validation**
- id length = 20 alphanumeric characters
- id are not sequential
### Season title

[Season Collection](#season-collection)
The \<**string**\> value of the title of the Season or Volume. This title can include Part 1, 2, etc. This can differ from the `nuber` value in the season collection. It is essentially the display value for the Season entry. Could also be a Special release like christmas special, live show, musical, etc. In this case the season number will be `N/A`

**validation**
- no max length
- not empty
### Season seriesId

[Season Collection](#season-collection)
The <**string**> value for the id of the series collection entry in firebase. It directly maps to the series entry to be able to easily retrieve series data when necessary.

**validation**
- id length = 20 alphanumeric characters
- not empty, Series entry must exist first before season data is created.
- update the series.seasons field in the series collection document to include the id of this season collection document.
### Season number

[Season Collection](#season-collection)
The <**string**> value for the season or volume number. It should be formatted to include either `Season` or `Volume` in the value. (ex. `Season 2` or `Volume 1`). If the title is a special instead of a numbered season default to `N/A`

**validation**
- Check for either `Season` or `Volume` prefix in the value
- Check for a number or Roman Numeral as the suffix
- If Season is non-numbered use `N/A`
- Ensure not null, default should be "Unknown"
### Season countries

[Season Collection](#season-collection)
The \<**string\[\]**\> representing the country/countries where the Season was filmed/was released.
Because of the possibility of country name changes in the past or future no value validation is necessary

**validation**
- N/A
- If no country association is found, ensure the field exists with an empty array
### Season directors

[Season Collection](#season-collection)
A \<**SeasonDirector\[\]**\> of the director(s) involved in creating the Season.

- **SeasonDirector** Object
	- **name**: A \<**string**\> of the Director's name
	- **title**: A \<**string**\> of the title of the director on this Season
	- **directorId**: A <**unique string**> of the id for the director in the **directors** Firebase collection

**validation**
- Check if the directorId exists in the **directors** collection before adding a new entry in Firebase
	- If multiple directors with the same name use an identifier like "Director Name (1)"
	- If it exists already update the entry instead of creating a new one.
- title should be one of the following
	- Director - if only one name
	- Co-Director - if multiple names in array
- name should not be blank
- id should not be blank, if so, add entry in directors collection first
### Season imageFiles

[Season Collection](#season-collection)
An \<**ImageFile\[\]**\> that contain info images for the Season specific posters, covers, or stills.  There isn't another images collection and all associated images will have to be managed in the collection they belong to. If deleted from this field in the firebase collection there will not be another way to undo the action. There will likely be a URL for poster image from the omdb response.
- **ImageFile** Object: 
	- **fileName**: The \<**string**\> of the URL Path where the image is stored
	- **fileSize**: A \<**string**\> of the file size of the image to be retrieved
	- **format**: A \<**string**\> of the file type for the image (ex. png, jpeg, jpg, etc.)
	- **resolution**: A \<**string**\> representing the aspect ratio or dimensions of the image

**validation**
- If the array is empty ensure a default missing poster image is displayed instead
- For each entry, ensure there is a `fileName` value
- Check that the units of the `fileSize` value are in bytes for more accuracy
- Ensure there is an entry in the format field, even if it's `Unknown` if no info
- Eventually add a check to get the resolution by analyzing the image metadata
### Season plexLink

[Season Collection](#season-collection)
A \<**string**\> for the URL of the plex page for the series. Helpful for adding the Season to a watchlist on the site.

**validation**
- This is ok to be empty
- If an entry exists ensure it is in the format: `https://watch.plex.tv/show/{show-name/season/{season-number}?{optional-context-data}`
### Season releaseYear

[Season Collection](#season-collection)
The <**string**> value of the year that the season Pilot first aired or was released.

**validation**
- Ensure the value is not null
- Default to an empty string
- if value exists ensure it is a single year 1850-{currentYear}
### Season releases

[Season Collection](#season-collection)
A \<**Release\[\]**\> for the known releases of the Season on physical media (DVD, BluRay, VHS, etc.) There can be multiple release entries for the same physical media type, but must differ in either name or year. the releaseName, releaseType, and year will all exist in the releases collection but are included here to make it easier to display without too many extra calls.
	- **Release** Object
		- **releaseId**: A \<**unique string**\> of the entry in the **releases** collection in the Firebase Database
		- **releaseType**: A \<**string**\> of the release type (DVD, BluRay, VHS, etc.)
		- **year**: A \<**string**\> of the year of the release
		- **releaseName**: A \<**string**\> for the title/name of the release (Director's Cut, Special Edition, etc.)

**validation**
- Must include a releaseID in each of the entries in the array and must be unique, which means a entry must exist in the releases Firebase collection prior to be added to this array
- releaseName must exist for each of the entries
- year must be a single year between 1850-{current year}, not the year the season aired but the year the release was put out
- releaseType must be one of the following:
	- DVD
	- BLURAY
	- VHS
	- HDDVD
	- BETA
	- PSP
	- BLURAY-3D
### Season cast

[Season Collection](#season-collection)
An \<**Actor\[\]**\> where the entries represent Actors in the Season.  All Actors included here should already have entries in the `actors` Firebase collection prior to being added here. An actor can be an actual actor, a voice, or even a cameo appearance.
	- **Actor** Object
		- **name**: A \<**string**\> of the Actor's full name
		- **actorId**: A \<**string**\> of the id for the actor in the **actors** Firebase collection
		- **characters**: A \<**string\[\]**\> of all of the Characters that the actor played or voiced for the season.

**validation**
- The array can be empty
- Each entry needs an associated actorId for an entry in the `actors` collection prior to being added to this array
- The actorId should be a unique id of length 20
- the name should be the full name of the actor
	- if the actor is known by multiple names they go by use the one in the actors collection entry.
- characters field doesn't need to contain an entry, but can also contain multiple entries if the actor had multiple roles in the series.
### Season writers

[Season Collection](#season-collection)
A \<**string\[\]**\> of the names of writers with credits in the season

**validation**
- The string array can be empty
- Each entry, if they exist, should contain the full name of the writer.
- There should not be multiple entries with the same exact name.
### Season episodes

[Season Collection](#season-collection)
An <**EpisodeData\[\]**> that hold preview data for the episodes in the Season.
	- **EpisodeData** Structure
		- **episodeId**: A <**string**> value for the reference to the Episode entry in the episode collection
		- **episodeName**: A <**string**> value of the name of the episode.
		- **episodeNumber**: A <**string**> value for the number of the episode in the current season

**validation**:
- Ensure the value is a <**EpisodeData\[\]**>
- Only add Episodes once they have entries in the Episode Collection
- This list should be empty when setting up the Season initially
- When entries are added ensure episodeId is in Episode collection
	- Ensure episodeName has a string value
	- Ensure the Episode number is a string of the EpisodeNumber.number + EpisodeNumber.variation if the variation exists.
### Season languages

[Season Collection](#season-collection)
The \<**sting\[\]**\> for the original language(s) the Season was filmed using.

**validation**
- Ensure that the array is one of the recognized languages
- Use a list from wikipedia for possible languages (or a library if one exists)
### Season omdbData

[Season Collection](#season-collection)
A \<**OmdbData**\> object containing all of the known information for the series retrieved from the [[Online Movie Database (OMDB) | OMDB API]].
There should be no changes made to this object after it gets returned by the API. By saving the full response we can keep from reaching the daily limit for calls to OMDB API easier.
## Episode Collection

The Episode Collection holds data for a single Episode of a Season in the series collection. For series with volumes instead of seasons that data will also be held here. It will have both the id of the Season it's a part of and the Series it was a part of. 
### Episode Collection Structure

- [id](#episode-id): <**string**>
- [title](#episode-title): <**string**>
- [seasonId](#episode-seasonid): <**string**>
- [seriesId](#episode-seriesId): <**string**>
- [episodeNumber](#episode-episodeNumber): <**EpisodeNumber**>
- [plot](#episode-plot): <**string**>
- [countries](#episode-countries): <**string\[\]**>
- [directors](#episode-directors): <**EpisodeDirector\[\]**>
- [imageFiles](#episode-imageFiles): <**ImageFile\[\]**>
- [plexLink](#episode-plexLink): <**string**>
- [releaseDate](#episode-releaseDate): <**string**>
- [runtime](#Episode-runtime): <**string**>
- [cast](#Episode-cast): <**Actor\[\]**>
- [writers](#Episode-writers): <**string\[\]**>
- [languages](#Episode-languages): <**string\[\]**>
- [omdbData](#episode-omdbData): <**OmdbResponseFull**>
- [notes](#episode-notes): <**string**>
### Episode id

[Episode Collection](#episode-collection)
A \<**unique string**\> value automatically created by firebase when adding a new entry to the collection so I don't have to check for uniqueness each time.

**validation**
- id length = 20 alphanumeric characters
- id are not sequential
### Episode title

[Episode Collection](#episode-collection)
The \<**string**\> value of the title of the Episode without the episode number prefix. This title can include Part 1, 2, etc. If there are multiple titles then use one and add the other to the notes section

**validation**
- no max length
- not empty
### Episode seasonId

[Episode Collection](#episode-collection)
A <**string**> that holds the `id` for the Season object in the Firebase Collection. Use this to get the Season Data from Firebase.

**validation**
- id length = 20 alphanumeric characters
- ids are not sequential
- Ensure a Season object exists before creating episode
### Episode seriesId

[Episode Collection](#episode-collection)
A <**string**> that holds the `id` for the Series object in the Firebase Collection. Use this to get the Series Data from Firebase.

**validation**
- id length = 20 alphanumeric characters
- ids are not sequential
- Ensure a Season object exists before creating episode
### Episode episodeNumber

[Episode Collection](#episode-collection)
An <**EpisodeNumber**> object that will hold both the `number` of the episode in the season it is a part of and any `variation` that may apply (ex. Part 1, Volume 1, Original Version, etc.)
- **Episode Number** Structure
	- **number**: A <**string**> of the number that the episode is listed in the Season
	- **variation**: A <**string**> representing an optional variable to the episode number (2a, part 1, pilot, etc.)

**validation**
- Ensure the type of <**EpisodeNumber**>
- Ensure the **number** field is a string and the string parses to a number
- Check for the optional **variation** field and if it exists, ensure it is a string.
### Episode plot

[Episode Collection](#episode-collection)
A <**string**> value describing the plot of the Episode. This isn't a retelling of the description of the series, but just the storyline of the Episode.

**validation**
- Ensure the **plot** is a string type and if there is no known plot, that the value is an empty string ""
### Episode countries

[Episode Collection](#episode-collection)
The \<**string\[\]**\> representing the country/countries where the Episode was filmed/was released.
Because of the possibility of country name changes in the past or future no value validation is necessary

**validation**
- Ensure the type of the value is a <**string\[\]**> and that the list is empty if no information is known
### Episode directors

[Episode Collection](#episode-collection)
A \<**EpisodeDirector\[\]**\> of the director(s) involved in creating the Episode.

- **EpisodeDirector** Object
	- **name**: A \<**string**\> of the Director's name
	- **title**: A \<**string**\> of the title of the director on this Episode
	- **directorId**: A <**unique string**> of the id for the director in the **directors** Firebase collection

**validation**
- Check if the directorId exists in the **directors** collection before adding a new entry in Firebase
	- If multiple directors with the same name use an identifier like "Director Name (1)"
	- If it exists already update the entry instead of creating a new one.
- title should be one of the following
	- Director - if only one name
	- Co-Director - if multiple names in array
- name should not be blank
- directorId should not be blank, if so, add entry in directors collection first
### Episode imageFiles

[Episode Collection](#episode-collection)
An \<**ImageFile\[\]**\> that contain info images for the Episode specific posters, covers, or stills.  There isn't another images collection and all associated images will have to be managed in the collection they belong to. If deleted from this field in the firebase collection there will not be another way to undo the action. There will likely be a URL for poster image from the omdb response.
- **ImageFile** Object: 
	- **fileName**: The \<**string**\> of the URL Path where the image is stored
	- **fileSize**: A \<**string**\> of the file size of the image to be retrieved
	- **format**: A \<**string**\> of the file type for the image (ex. png, jpeg, jpg, etc.)
	- **resolution**: A \<**string**\> representing the aspect ratio or dimensions of the image

**validation**
- If the array is empty ensure a default missing poster image is displayed instead
- For each entry, ensure there is a `fileName` value
- Check that the units of the `fileSize` value are in bytes for more accuracy
- Ensure there is an entry in the format field, even if it's `Unknown` if no info
- Eventually add a check to get the resolution by analyzing the image metadata
### Episode plex Link

[Episode Collection](#episode-collection)
A \<**string**\> for the URL of the plex page for the series. Helpful for adding the Season to a watchlist on the site.

**validation**
- This is ok to be empty
- The link should be to the Season that the episode is in instead of the actual episode link.
- If an entry exists ensure it is in the format: `https://watch.plex.tv/show/{show-name/season/{season-number}?{optional-context-data}`
### Episode releaseDate

[Episode Collection](#episode-collection)
A <**string**> representing the date that the episode originally aired on television or was released on a streaming service.

**validation**
- Ensure that the value, if unknown, is an empty string
- If the value exists ensure the format matches `{Month} {Day}, {Year}`
### Episode runtime

[Episode Collection](#episode-collection)
A <**string**> representing the runtime of the Episode

**validation**
- Ensure that the value, if unknown, is an empty string
- If the value exists, ensure the format matches `{Hours}:{Minutes}:{Seconds}`
### Episode cast

[Episode Collection](#episode-collection)
An \<**Actor\[\]**\> where the entries represent Actors in the Episode.  All Actors included here should already have entries in the `actors` Firebase collection prior to being added here. An actor can be an actual actor, a voice, or even a cameo appearance.
	- **Actor** Object
		- **name**: A \<**string**\> of the Actor's full name
		- **actorId**: A \<**string**\> of the id for the actor in the **actors** Firebase collection
		- **characters**: A \<**string\[\]**\> of all of the Characters that the actor played or voiced for the season.

**validation**
- The array can be empty
- Each entry needs an associated actorId for an entry in the `actors` collection prior to being added to this array
- The actorId should be a unique id of length 20
- the name should be the full name of the actor
	- if the actor is known by multiple names they go by use the one in the actors collection entry.
- characters field doesn't need to contain an entry, but can also contain multiple entries if the actor had multiple roles in the series.
### Episode writers

[Episode Collection](#episode-collection)
A \<**string\[\]**\> of the names of writers with credits in the Episode

**validation**
- The string array can be empty
- Each entry, if they exist, should contain the full name of the writer.
- There should not be multiple entries with the same exact name.
### Episode languages

[Episode Collection](#episode-collection)
The \<**sting\[\]**\> for the original language(s) the Episode was filmed using.

**validation**
- Ensure that the array is one of the recognized languages
- Use a list from wikipedia for possible languages (or a library if one exists)
### Episode omdbData

[Episode Collection](#episode-collection)
A \<**OmdbData**\> object containing all of the known information for the series retrieved from the [[Online Movie Database (OMDB) | OMDB API]].
There should be no changes made to this object after it gets returned by the API. By saving the full response we can keep from reaching the daily limit for calls to OMDB API easier.
### Episode notes

[Episode Collection](#episode-collection)
A <**string**> to hold any information for the Episode that doesn't fit into one of the other fields yet.

**validation**
- Ensure the value is a string, empty string if no info. No other validation needed.
## Release Collection

The Release Collection holds all of the information for releases of Movies, Series, or Seasons on physical media. (Streaming Only releases to be managed in the future). It is meant to reference the collection(s) of the media type for all of the information related to the subject matter. This should hold information specific to the physical media release only.
### Release Collection Structure

- [id](#release-id): <**string**>
- [containsExtras](#release-containsextras): <**boolean**>
- [extras](#release-extras): <**Extra\[\]**>
- [containsInserts](#release-containsinserts): <**boolean**>
- [inserts](#release-inserts): <**Insert\[\]**>
- [discIds](#release-discIds): <**DiscInfo\[\]**>
- [discTypes](#release-disctypes): <**string\[\]**>
- [episodeIds](#release-episodeids): <**EpisodeInfoSmall\[\]**>
- [mediaType](#release-mediatype): <**string**>
- [movieIds](#release-movieids): <**MovieInfoSmall\[\]**>
- [seasonIds](#release-seasonids): <**SeasonInfoSmall\[\]**>
- [seriesIds](#release-seriesids): <**SeriesInfoSmall\[\]**>
- [title](#release-title): <**string**>
- [year](#release-year): <**number**>
- [imageFiles](#release-imagefiles): <**ImageFile\[\]**>

### Release id

[Release Structure](#release-structure)
A \<**unique string**\> value automatically created by firebase when adding a new entry to the collection so I don't have to check for uniqueness each time.

**validation**
- id length = 20 alphanumeric characters
- id are not sequential
### Release containsExtras

[Release Structure](#release-structure)
A <**boolean**> representing whether the Release contains extras . The inserts considered are specifically inserts for the media in the Release. Disregards ads and other promotional materials.

**validation**
- Check that the value is a boolean
### Release extras

[Release Structure](#release-structure)
An <**Extra\[\]**> with information about the extras in the Release. Info should include a description of the extra, runtime, and any stills or images.
- **Insert** Object
	- **description**: A <**string**> of a description of the insert
	- **extraImage**: A <**string**\[\]> of the paths of the extras image in the image Server
	- **runtime**: A <**string**> of the runtime for the Extra, in the format "{Hours}:{Minutes}:{Seconds}"

**validation**
- Ensure the List is only of type **Insert**
- Ensure each of the entries in thee Extra objects are proper type
- Check that the extraImage matches the path format
- Check that the runtime matches the format described, else an empty String
### Release containsInserts

[Release Structure](#release-structure)
A <**boolean**> representing whether the Release contains inserts or not. The inserts considered are specifically inserts for the media in the Release. Disregards ads and other promotional materials.

**validation**
- Check that the value is a boolean
### Release inserts

[Release Structure](#release-structure)
An <**Insert\[\]**> with information about the inserts in the Release. Info should include a description of the insert and any information actually on the inserts.
- **Insert** Object
	- **description**: A <**string**> of a description of the insert
	- **insertImage**: A <**string**> of the path of the insert image in the image Server
	- dataString: A <**string**> of the data in the insert

**validation**
- Ensure the List is only of type **Insert**
- Ensure each of the entries in thee Extra objects are strings
- Check that the insertImage matches the path format
### Release discIds

[Release Structure](#release-structure)
A <**string\[\]**> of ids relating to the Disc Collection in Firebase. These disc should be all of the discs in the release. This should be an empty array when the Release is first created. These discIds should be added only during an update when the disc information is added to the Disc Collection in Firebase.

**validation**
- Entries should be type String when updated.
- On creation should be an empty Array.
### Release discTypes

[Release Structure](#release-structure)
A <**string\[\]**> of the types of the disc in the release.

**validation**
- Each entry should be an Enum of the following list of options:
	- DVD
	- BLURAY
	- VHS
	- HDDVD
	- BETA
	- PSP
	- BLURAY-3D
- Should be at least one type listed.
### Release episodeIds

[Release Structure](#release-structure)
A <**string\[\]**> of ids for entries in the Episode Collection in Firebase. These should be created before the release object is added. 

**validation**
- Should follow the same validation rules for all ids from Firebase
- If no episodes in the release include an empty array
### Release mediaType

[Release Structure](#release-structure)
A <**string**> representing the type of Release.

**validation**
- The entry should be an enum from the list of acceptable values
	- MOVIE
	- SERIES
	- SEASON
	- DOUBLE_FEATURE
	- COLLECTION
	- LIVE_PERFORMANCE
### Release movieIds

[Release Structure](#release-structure)
A <**string\[\]**> of ids for entries in the Movie Collection in Firebase. These should be created before the release object is added. 

**validation**
- Should follow the same validation rules for all ids from Firebase
- If no episodes in the release include an empty array
### Release seasonIds

[Release Structure](#release-structure)
A <**string\[\]**> of ids for entries in the Season Collection in Firebase. These should be created before the release object is added. 

**validation**
- Should follow the same validation rules for all ids from Firebase
- If no episodes in the release include an empty array
### Release seriesIds

[Release Structure](#release-structure)
A <**string\[\]**> of ids for entries in the Series Collection in Firebase. These should be created before the release object is added. 

**validation**
- Should follow the same validation rules for all ids from Firebase
- If no episodes in the release include an empty array
### Release title

[Release Structure](#release-structure)
A <**string**> of the Title of the Release. Should include any variation information such as Director's Cut, Extended Version, Theatrical Cut, etc.

**validation**
- Ensure the value is type string.
- Ensure the String is not empty, there should be some type of title
### Release year

[Release Structure](#release-structure)
A <**string**> of the year that the release came out.

**validation**
- Check that the value is of type String
- Should not be an empty year
### Release imageFiles

[Release Structure](#release-structure)
An \<**ImageFile\[\]**\> that contain info images for the Release specific posters, covers, or stills.  There isn't another images collection and all associated images will have to be managed in the collection they belong to. If deleted from this field in the firebase collection there will not be another way to undo the action. There will likely be a URL for poster image from the omdb response.
- **ImageFile** Object: 
	- **fileName**: The \<**string**\> of the URL Path where the image is stored
	- **fileSize**: A \<**string**\> of the file size of the image to be retrieved
	- **format**: A \<**string**\> of the file type for the image (ex. png, jpeg, jpg, etc.)
	- **resolution**: A \<**string**\> representing the aspect ratio or dimensions of the image

**validation**
- If the array is empty ensure a default missing poster image is displayed instead
- For each entry, ensure there is a `fileName` value
- Check that the units of the `fileSize` value are in bytes for more accuracy
- Ensure there is an entry in the format field, even if it's `Unknown` if no info
- Eventually add a check to get the resolution by analyzing the image metadata


## Actor Collection

The Actor Collection holds entries for actors, or any cast member (even cameo appearances). Each document in the collection will have the Actor's name, as well as a list of movies and series that they appeared/voiced in. To find out character information it can be retrieved from the document for each movie or series collection.
### Actor Collection Structure
- [id](#actor-id): <**unique string**>
- [fullName](#actor-fullName): <**string**>
- [movieIds](#actor-movieids): <**string\[\]**>
- [seriesIds](#actor-seriesIds): <**string\[\]**>
- [birthplace](#actor-birthplace): <**string**>
- [birthday](#actor-birthday): <**string**>
- [notes](#actor-notes): <**string**>
## Director Collection

The Director Collection holds entries for directors for both movies and series. Each document in the collection will have the Director's name, as well as a list of movies and series that they directed.
### Director Collection Structure
- [id](#director-id): <**unique string**>
- [fullName](#director-fullName): <**string**>
- [movieIds](#director-movieids): <**string\[\]**>
- [seriesIds](#director-seriesIds): <**string\[\]**>
- [birthplace](#director-birthplace): <**string**>
- [birthday](#director-birthday): <**string**>
- [notes](#director-notes): <**string**>
