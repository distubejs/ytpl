const { request } = require('undici');

const DEFAULT_OPTIONS = { limit: Infinity };
const DEFAULT_QUERY = { gl: 'US', hl: 'en' };
const DEFAULT_CONTEXT = {
  client: {
    utcOffsetMinutes: -300,
    gl: 'US',
    hl: 'en',
    clientName: 'WEB',
    clientVersion: '<important information>',
  },
  user: {},
  request: {},
};
const CONSENT_COOKIE = 'SOCS=CAI';

const tryParseBetween = (body, left, right, addEndCurly = false) => {
  try {
    let data = between(body, left, right);
    if (!data) return null;
    if (addEndCurly) data += '}';
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
};

exports.parseBody = (body, options = {}) => {
  const json =
    tryParseBetween(body, 'var ytInitialData = ', '};', true) ||
    tryParseBetween(body, 'window["ytInitialData"] = ', '};', true) ||
    tryParseBetween(body, 'var ytInitialData = ', ';</script>') ||
    tryParseBetween(body, 'window["ytInitialData"] = ', ';</script>');
  const apiKey = between(body, 'INNERTUBE_API_KEY":"', '"') ||
    between(body, 'innertubeApiKey":"', '"');
  const clientVersion = between(body, 'INNERTUBE_CONTEXT_CLIENT_VERSION":"', '"') ||
    between(body, 'innertube_context_client_version":"', '"');
  // Make deep copy and set clientVersion
  const context = JSON.parse(JSON.stringify(DEFAULT_CONTEXT));
  context.client.clientVersion = clientVersion;
  // Copy params to context
  if (options.gl) context.client.gl = options.gl;
  if (options.hl) context.client.hl = options.hl;
  if (options.utcOffsetMinutes) context.client.utcOffsetMinutes = options.utcOffsetMinutes;
  // Return multiple values
  return { json, apiKey, context };
};

// Parsing utility
const parseText = exports.parseText = txt => {
  if (txt.simpleText) return txt.simpleText;
  if (txt.runs) return txt.runs.map(a => a.text).join('');
  return '';
};

exports.parseNumFromText = txt => Number(parseText(txt).replace(/\D+/g, ''));

// Request Utility
exports.doPost = (url, opts, payload) => {
  if (!opts) opts = {};
  // Enforce POST-Request
  const reqOpts = Object.assign({}, opts, { method: 'POST', body: JSON.stringify(payload) });
  return request(url, reqOpts).then(r => r.body.json());
};

// Guarantee that all arguments are valid
exports.checkArgs = (plistId, options = {}) => {
  // Validation
  if (!plistId) {
    throw new Error('playlist ID is mandatory');
  }
  if (typeof plistId !== 'string') {
    throw new Error('playlist ID must be of type string');
  }


  // Normalisation
  let obj = Object.assign({}, DEFAULT_OPTIONS, options);
  // Other optional params
  if (isNaN(obj.limit) || obj.limit <= 0) obj.limit = DEFAULT_OPTIONS.limit;
  // Set required parameter: query
  obj.query = Object.assign({}, DEFAULT_QUERY, obj.query, { list: plistId });
  if (options && options.gl) obj.query.gl = options.gl;
  if (options && options.hl) obj.query.hl = options.hl;
  // Default requestOptions
  if (!options.requestOptions) options.requestOptions = {};
  // Unlink requestOptions
  obj.requestOptions = Object.assign({}, options.requestOptions);
  // Unlink requestOptions#headers
  obj.requestOptions.headers = obj.requestOptions.headers ? JSON.parse(JSON.stringify(obj.requestOptions.headers)) : {};

  if (!getPropInsensitive(obj.requestOptions.headers, 'user-agent')) {
    setPropInsensitive(obj.requestOptions.headers, 'user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.101 Safari/537.36');
  }

  const cookie = getPropInsensitive(obj.requestOptions.headers, 'cookie');
  if (!cookie) {
    setPropInsensitive(obj.requestOptions.headers, 'cookie', CONSENT_COOKIE);
  } else if (!cookie.includes('SOCS=')) {
    setPropInsensitive(obj.requestOptions.headers, 'cookie', `${cookie}; ${CONSENT_COOKIE}`);
  }
  return obj;
};

/**
 * Extract string between another.
 * Property of https://github.com/fent/node-ytdl-core/blob/master/lib/utils.js
 *
 * @param {string} haystack haystack
 * @param {string} left left
 * @param {string} right right
 * @returns {string}
 */
const between = exports.between = (haystack, left, right) => {
  let pos;
  if (left instanceof RegExp) {
    const match = haystack.match(left);
    if (!match) { return ''; }
    pos = match.index + match[0].length;
  } else {
    pos = haystack.indexOf(left);
    if (pos === -1) { return ''; }
    pos += left.length;
  }
  haystack = haystack.slice(pos);
  pos = haystack.indexOf(right);
  if (pos === -1) { return ''; }
  haystack = haystack.slice(0, pos);
  return haystack;
};

const findPropKeyInsensitive = (obj, prop) =>
  Object.keys(obj).find(p => p.toLowerCase() === prop.toLowerCase()) || null;

const getPropInsensitive = (obj, prop) => {
  const key = findPropKeyInsensitive(obj, prop);
  return key && obj[key];
};

const setPropInsensitive = (obj, prop, value) => {
  const key = findPropKeyInsensitive(obj, prop);
  obj[key || prop] = value;
  return key;
};
