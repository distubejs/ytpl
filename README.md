# @distube/ytpl

A light-weight ytpl for [DisTube](https://distube.js.org). Original [ytpl](https://www.npmjs.com/package/ytpl).
Simple js only package to resolve YouTube Playlists.
Does not require any login or Google-API-Key.

# Installation

```bash
npm install @distube/ytpl
```

# Usage

```js
const ytpl = require("@distube/ytpl");

const playlist = await ytpl("https://www.youtube.com/playlist?list=PLRBp0Fe2GpglkzuspoGv-mu7B2ce9_0Fn");
```

# API

### ytpl(id, [options])

Attempts to resolve the given playlist id

- `id`
  - id of the yt-playlist
  - or a playlist url
  - or a user url (resolves to uploaded playlist)
  - or a channel url (resolves to uploaded playlist)
- `options`

  - object with options
  - possible settings:
  - gl[String] -> 2-Digit Code of a Country, defaults to `US` - Allows for localisation of the request
  - hl[String] -> 2-Digit Code for a Language, defaults to `en` - Allows for localisation of the request
  - utcOffsetMinutes[Number] -> Offset in minutes from UTC, defaults to `-300` - Allows for localisation of the request
  - limit[Number] -> limits the pulled items, defaults to 100, set to Infinity to get the whole playlist - numbers <1 result in the default being used
  - requestOptions[Object] -> All additional parameters will get passed to undici's [request options](https://github.com/nodejs/undici#undicirequesturl-options-promise), which is used to do the https requests

- returns a Promise
- [Example response](https://github.com/distubejs/ytpl/blob/master/example/example_output)

### ytpl.validateID(string)

Returns true if able to parse out a (formally) valid playlist ID.

### ytpl.getPlaylistID(string)

Returns a playlist ID from a YouTube URL. Can be called with the playlist ID directly, in which case it resolves.

Returns a promise.

# Related / Works well with

- [DisTube](https://github.com/skick1234/DisTube) - A Discord.js module to simplify your music commands and play songs with audio filters on Discord without any API key.
- [@distube/ytdl-core](https://github.com/distubejs/ytdl-core) - DisTube fork of [ytdl](https://github.com/fent/node-ytdl-core).
- [@distube/ytsr](https://github.com/distubejs/ytsr) - DisTube fork of [ytsr](https://github.com/TimeForANinja/node-ytsr).
