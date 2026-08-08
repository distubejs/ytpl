const UTIL = require('./util.js');
const QS = require('node:querystring');
const PARSE_ITEM = require('./parseItem.js');
const { request } = require('undici');
const PATH = require('node:path');
const FS = require('node:fs');

const BASE_PLIST_URL = 'https://www.youtube.com/playlist?';
const BASE_API_URL = 'https://www.youtube.com/youtubei/v1/browse?key=';

// Helper function to safely extract continuation token
const getContinuationToken = (item) => {
  const renderer = item?.continuationItemRenderer;
  if (!renderer) return null;

  try {
    // Try the standard path first
    if (renderer.continuationEndpoint?.continuationCommand?.token) {
      return renderer.continuationEndpoint.continuationCommand.token;
    }

    // Try alternative paths that YouTube sometimes uses
    if (renderer.button?.buttonRenderer?.command?.continuationCommand?.token) {
      return renderer.button.buttonRenderer.command.continuationCommand.token;
    }

    // Another alternative path
    if (renderer.trigger?.continuationCommand?.token) {
      return renderer.trigger.continuationCommand.token;
    }

    // Try looking for any continuation command recursively
    const findTokenRecursively = (obj) => {
      if (!obj || typeof obj !== 'object') return null;

      if (obj.continuationCommand?.token) {
        return obj.continuationCommand.token;
      }

      for (const key in obj) {
        if (Object.hasOwn(obj, key)) {
          const result = findTokenRecursively(obj[key]);
          if (result) return result;
        }
      }
      return null;
    };

    return findTokenRecursively(renderer);
  } catch (_e) {
    return null;
  }
};

// eslint-disable-next-line complexity
const main = async (linkOrId, options, rt = 3) => {
  // Set default values
  const plistId = await main.getPlaylistID(linkOrId);
  const opts = UTIL.checkArgs(plistId, options);

  const ref = BASE_PLIST_URL + QS.encode(opts.query);
  const body = await request(ref, opts.requestOptions).then((r) => r.body.text());
  const parsed = UTIL.parseBody(body, opts);
  if (!parsed.json) {
    try {
      let browseId = UTIL.between(body, '"key":"browse_id","value":"', '"');
      if (!browseId) browseId = `VL${plistId}`;
      if (!parsed.apiKey || !parsed.context.client.clientVersion) throw new Error('Missing api key');
      parsed.json = await UTIL.doPost(BASE_API_URL + parsed.apiKey, opts, { context: parsed.context, browseId });
    } catch (_e) {
      // Unknown
    }
  }

  // Youtube might just load the main page and set statuscode 204
  if (!parsed.json.sidebar) throw new Error('Unknown Playlist');

  // Retry if unable to find json => most likely old response
  if (!parsed.json) {
    if (rt === 0) {
      logger(body);
      throw new Error('Unsupported playlist');
    }
    return main(linkOrId, opts, rt - 1);
  }

  // Parse alerts
  if (parsed.json.alerts && !parsed.json.contents) {
    // Parse error
    const error = parsed.json.alerts.find((a) => a.alertRenderer && a.alertRenderer.type === 'ERROR');
    if (error) throw new Error(UTIL.parseText(error.alertRenderer.text));
  }

  try {
    const primaryInfoRender = 'playlistSidebarPrimaryInfoRenderer';
    
    const info = parsed.json.sidebar.playlistSidebarRenderer.items.find(obj => primaryInfoRender in obj)[primaryInfoRender];
    const thumbnail = Object.values(info.thumbnailRenderer)[0].thumbnail.thumbnails.toSorted((a,b)=>b.width-a.width)[0];
    
    const resp = {
      id: plistId,
      thumbnail,
      url: `${BASE_PLIST_URL}list=${plistId}`,
      title: UTIL.parseText(info.title),
      description: UTIL.parseText(info.description),
      total_items: UTIL.parseNumFromText(info.stats[0]),
      views: info.stats.length === 3 ? UTIL.parseNumFromText(info.stats[1]) : 0,
    };
    
    const itemSectionRenderer = parsed.json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents.find(x => x.itemSectionRenderer);
    if (!itemSectionRenderer) throw Error('Empty playlist (itemSectionRenderer)');
    
    const items = itemSectionRenderer.itemSectionRenderer.contents;
    resp.items = [];
    
    parseVideos(resp, items);
    
    if(resp.cont && resp.items.length < opts.limit){
      const token = resp.cont.continuationCommand.innertubeCommand.continuationCommand.token;
      await parsePage2(resp, parsed.apiKey, token, parsed.context, opts);
    }
    
    resp.items.length = Math.min(resp.items.length, opts.limit);
    return resp;
  }
  catch (e) {
    if (rt === 0) {
      logger(body);
      throw new Error(e);
    }
    return main(linkOrId, opts, rt - 1);
  }
};

const parseVideos = (resp, items) => {
  for(const view of items){
    if(view.continuationItemViewModel){
      resp.cont = view.continuationItemViewModel;
      break;
    }
    
    const lockup = view.lockupViewModel;
    const metadata = lockup.metadata.lockupMetadataViewModel;
    const contentMetadata = metadata.metadata.contentMetadataViewModel;
    
    const authorText =
      contentMetadata.metadataRows?.[0]
        ?.metadataParts?.[0]
        ?.text;
    
    const authorCommand =
      authorText?.commandRuns?.[0]
        ?.onTap?.innertubeCommand;
    
    const videoPath =
      lockup.rendererContext?.commandContext?.onTap
        ?.innertubeCommand?.commandMetadata
        ?.webCommandMetadata?.url;
    
    const thumbnails =
      lockup.contentImage?.thumbnailViewModel
        ?.image?.sources ?? [];
    
    const badges =
      lockup.contentImage?.thumbnailViewModel
        ?.overlays?.flatMap(overlay =>
          overlay.thumbnailBottomOverlayViewModel?.badges ?? []
        )
        .map(item => item.thumbnailBadgeViewModel)
        .filter(Boolean) ?? [];
    
    const vitem = {
      title: metadata.title?.content ?? '',
      
      id: lockup.contentId ?? '',
      
      shortUrl: `https://www.youtube.com/watch?v=${lockup.contentId}`,
      
      url: videoPath
        ? new URL(videoPath, 'https://www.youtube.com').href
        : '',
      
      author: {
        url: authorCommand?.commandMetadata
          ?.webCommandMetadata?.url
          ? new URL(
              authorCommand.commandMetadata.webCommandMetadata.url,
              'https://www.youtube.com'
            ).href
          : '',
        
        channelID:
          authorCommand?.browseEndpoint?.browseId ?? '',
        
        name: authorText?.content ?? ''
      },
      
      thumbnail: thumbnails.at(-1)?.url ?? '',
      
      isLive: badges.some(badge =>
        badge.badgeStyle?.includes('LIVE') ||
        badge.text?.trim().toUpperCase() === 'LIVE'
      ),
      
      duration:
        badges.find(badge =>
          /^\d+(?::\d+)+$/.test(badge.text?.trim() ?? '')
        )?.text?.trim() ?? ''
    };
    
    resp.items.push(vitem);
  }
};

module.exports = main;

const parsePage2 = async (resp, apiKey, token, context, opts) => {
  const json = await UTIL.doPost(BASE_API_URL + apiKey, opts.requestOptions, { context, continuation: token });
  delete resp.cont;
  
  if (!json.onResponseReceivedActions) return;
  const wrapper = json.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems;
  parseVideos(resp, wrapper);
  
  if(resp.items.length > opts.limit){
      delete resp.cont;
  }
  
  if(resp.cont){
      const nextToken = resp.cont.continuationCommand.innertubeCommand.continuationCommand.token;
      await parsePage2(resp, apiKey, nextToken, context, opts);
  }
};

const YT_HOSTS = ['www.youtube.com', 'youtube.com', 'music.youtube.com'];
// Checks for a (syntactically) valid URL - mostly equals getPlaylistID
main.validateID = (linkOrId) => {
  // Validate inputs
  if (typeof linkOrId !== 'string' || !linkOrId) {
    return false;
  }
  // Clean id provided
  if (PLAYLIST_REGEX.test(linkOrId) || ALBUM_REGEX.test(linkOrId)) {
    return true;
  }
  if (CHANNEL_REGEX.test(linkOrId)) {
    return true;
  }
  // Playlist link provided
  const parsed = new URL(linkOrId, BASE_PLIST_URL);
  if (!YT_HOSTS.includes(parsed.host)) return false;
  if (parsed.searchParams.has('list')) {
    const listParam = parsed.searchParams.get('list');
    if (PLAYLIST_REGEX.test(listParam) || ALBUM_REGEX.test(listParam)) {
      return true;
    }
    // Mixes currently not supported
    // They would require fetching a video page & resolving the side-loaded playlist
    if (listParam?.startsWith('RD')) {
      return false;
    }
    return false;
  }
  // Shortened channel or user page provided
  const p = parsed.pathname.substr(1).split('/');
  if (p.length < 2 || p.some((a) => !a)) return false;
  const maybeType = p[p.length - 2];
  const maybeId = p[p.length - 1];
  if (maybeType === 'channel') {
    if (CHANNEL_REGEX.test(maybeId)) {
      return true;
    }
  } else if (maybeType === 'user') {
    // No request in here since we wanna keep it sync
    return true;
  } else if (maybeType === 'c') {
    // No request in here since we wanna keep it sync
    return true;
  }
  return false;
};

// Parse the input to a id (or error)
const PLAYLIST_REGEX = /^(FL|PL|UU|LL|RD)[a-zA-Z0-9-_]{11,41}$/;
exports.PLAYLIST_REGEX = PLAYLIST_REGEX;
const ALBUM_REGEX = /^OLAK5uy_[a-zA-Z0-9-_]{33}$/;
exports.ALBUM_REGEX = ALBUM_REGEX;
const CHANNEL_REGEX = /^UC[a-zA-Z0-9-_]{22,32}$/;
exports.CHANNEL_REGEX = CHANNEL_REGEX;
main.getPlaylistID = async (linkOrId) => {
  // Validate inputs
  if (typeof linkOrId !== 'string' || !linkOrId) {
    throw new Error('The linkOrId has to be a string');
  }
  // Clean id provided
  if (PLAYLIST_REGEX.test(linkOrId) || ALBUM_REGEX.test(linkOrId)) {
    return linkOrId;
  }
  if (CHANNEL_REGEX.test(linkOrId)) {
    return `UU${linkOrId.substr(2)}`;
  }
  // Playlist link provided
  const parsed = new URL(linkOrId, BASE_PLIST_URL);
  if (!YT_HOSTS.includes(parsed.host)) throw new Error('not a known youtube link');
  if (parsed.searchParams.has('list')) {
    const listParam = parsed.searchParams.get('list');
    if (PLAYLIST_REGEX.test(listParam) || ALBUM_REGEX.test(listParam)) {
      return listParam;
    }
    // Mixes currently not supported
    // They would require fetching a video page & resolving the side-loaded playlist
    if (listParam?.startsWith('RD')) {
      throw new Error('Mixes not supported');
    }
    // Default case
    throw new Error('invalid or unknown list query in url');
  }
  // Shortened channel or user page provided
  const p = parsed.pathname.substr(1).split('/');
  if (p.length < 2 || p.some((a) => !a)) {
    throw new Error(`Unable to find a id in "${linkOrId}"`);
  }
  const maybeType = p[p.length - 2];
  const maybeId = p[p.length - 1];
  if (maybeType === 'channel') {
    if (CHANNEL_REGEX.test(maybeId)) {
      return `UU${maybeId.substr(2)}`;
    }
  } else if (maybeType === 'user') {
    // eslint-disable-next-line no-return-await
    return await toChannelList(`https://www.youtube.com/user/${maybeId}`);
  } else if (maybeType === 'c') {
    // eslint-disable-next-line no-return-await
    return await toChannelList(`https://www.youtube.com/c/${maybeId}`);
  }
  throw new Error(`Unable to find a id in "${linkOrId}"`);
};

// Gets the channel uploads id of a user (needed for uploads playlist)
const CHANNEL_ONPAGE_REGEXP = /channel_id=UC([\w-]{22,32})"/;
const toChannelList = async (ref) => {
  const body = await request(ref).then((r) => r.body.text());
  const channelMatch = body.match(CHANNEL_ONPAGE_REGEXP);
  if (channelMatch) return `UU${channelMatch[1]}`;
  throw new Error(`unable to resolve the ref: ${ref}`);
};

const logger = (content) => {
  const dir = PATH.resolve(__dirname, '../dumps/');
  const file = PATH.resolve(dir, `${Math.random().toString(36).substr(3)}-${Date.now()}.txt`);
  const cfg = PATH.resolve(__dirname, '../package.json');
  const bugsRef = require(cfg).bugs.url;

  if (!FS.existsSync(dir)) FS.mkdirSync(dir);
  FS.writeFileSync(file, content);
  console.error(`\n/${'*'.repeat(200)}`);
  console.error('Unsupported YouTube Playlist response.');
  console.error(`Please post the the files in ${dir} to DisTube support server or ${bugsRef}. Thanks!`);
  console.error(`${'*'.repeat(200)}\\`);
  return null;
};
