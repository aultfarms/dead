export * from '../types.js';
import debug from 'debug';
import { type TrelloRESTFunction, type TrelloRequestFunction,
  assertTrelloBoards, assertTrelloBoard, assertTrelloOrgs, assertTrelloOrg,
  assertTrelloLists, assertTrelloList, assertTrelloCards, assertTrelloCard } from '../types.js';
import { getUniversalClient } from '../client.js';
import { idLabelsWriteSucceeded } from '../response.js';
import {
  canonicalTrelloReturnUrl,
  chooseTrelloToken,
  describeTokenChoice,
  getAuthorizationReport,
  noteTrelloAccess,
  updateAuthorizationFacts,
  type AuthorizationReport,
  type BoardStatus,
  type OrganizationStatus,
} from '../tokenChoice.js';
export { getAuthorizationReport, noteTrelloAccess, type AuthorizationReport };
const info = debug('af/trello#browser:info');
const AUTH_ATTEMPT_KEY = 'aultfarms.trelloAuthAttempt';

export * from '../index.js'; // export all the universal things

// dev key: 3ad06cb25802014a3f24f479e886771c
// URL to refresh client lib: https://api.trello.com/1/client.js?key=3ad06cb25802014a3f24f479e886771c
const devKey = '3ad06cb25802014a3f24f479e886771c';
//type BrowserTrelloRESTFunction = (path: string, params: TrelloRequestParams, success: TrelloSuccessCallback, err: TrelloRejectCallback) => void;

async function waitUntilLoaded(): Promise<void> { return; } // This library is always loaded

//-----------------------------------------------------------------
let token = '';
let environmentPromise: Promise<void> | null = null;

function storageError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readStoredToken(): { token: string; error: string } {
  try {
    return { token: localStorage.getItem('trello_token') || '', error: '' };
  } catch (error) {
    info('Error reading trello_token from localStorage', error);
    return { token: '', error: storageError(error) };
  }
}

function writeStoredToken(value: string): string {
  try {
    localStorage.setItem('trello_token', value);
    return '';
  } catch (error) {
    info('Error writing trello_token to localStorage', error);
    return storageError(error);
  }
}

function clearStoredToken(): void {
  try {
    localStorage.removeItem('trello_token');
  } catch (error) {
    info('Error clearing invalid trello_token from localStorage', error);
  }
}

function authAttemptPending(): boolean {
  try {
    return sessionStorage.getItem(AUTH_ATTEMPT_KEY) === '1';
  } catch (error) {
    info('Could not read Trello auth attempt flag', error);
    return false;
  }
}

function markAuthAttempt(): void {
  try {
    sessionStorage.setItem(AUTH_ATTEMPT_KEY, '1');
  } catch (error) {
    info('Could not record Trello auth attempt', error);
  }
}

function clearAuthAttempt(): void {
  try {
    sessionStorage.removeItem(AUTH_ATTEMPT_KEY);
  } catch (error) {
    info('Could not clear Trello auth attempt flag', error);
  }
}

export function allowAnotherTrelloLogin(): void {
  clearAuthAttempt();
}

function openedFrom(): string {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  return standalone ? 'a Home Screen icon' : 'Safari';
}

async function collectEnvironment(): Promise<void> {
  let serviceWorker = 'No service worker is controlling this page.';
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const controllerUrl = navigator.serviceWorker.controller?.scriptURL || '';
      if (controllerUrl || registrations.length > 0) {
        const urls = [
          controllerUrl,
          ...registrations.map(registration => (
            registration.active?.scriptURL
            || registration.waiting?.scriptURL
            || registration.installing?.scriptURL
            || registration.scope
          )),
        ].filter((url, index, all) => url && all.indexOf(url) === index);
        await Promise.all(registrations.map(registration => registration.unregister()));
        serviceWorker = `Unregistered leftover service worker (${urls.join(', ') || 'unknown script'}).`;
      }
    } catch (error) {
      serviceWorker = `Could not check service workers: ${storageError(error)}.`;
    }
  }
  let referrerIsTrello = false;
  try {
    referrerIsTrello = document.referrer
      ? new URL(document.referrer).hostname.endsWith('trello.com')
      : false;
  } catch (error) {
    info('Could not read document referrer', error);
  }
  updateAuthorizationFacts({
    openedFrom: openedFrom(),
    serviceWorker,
    trelloReturn: referrerIsTrello || window.location.hash.length > 1,
  });
}

function ensureEnvironment(): Promise<void> {
  if (!environmentPromise) environmentPromise = collectEnvironment();
  return environmentPromise;
}

type MemberCheck = {
  ok: boolean;
  status: number;
  username: string;
  fullName: string;
  networkError: string;
};

async function checkMember(currentToken: string): Promise<MemberCheck> {
  const url = new URL('https://api.trello.com/1/members/me');
  url.searchParams.set('key', devKey);
  url.searchParams.set('token', currentToken);
  url.searchParams.set('fields', 'username,fullName');
  try {
    const response = await fetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      return { ok: false, status: response.status, username: '', fullName: '', networkError: '' };
    }
    try {
      const body = await response.json() as { username?: unknown; fullName?: unknown };
      return {
        ok: true,
        status: response.status,
        username: typeof body.username === 'string' ? body.username : '',
        fullName: typeof body.fullName === 'string' ? body.fullName : '',
        networkError: '',
      };
    } catch (error) {
      return {
        ok: true,
        status: response.status,
        username: '',
        fullName: '',
        networkError: storageError(error),
      };
    }
  } catch (error) {
    return { ok: false, status: 0, username: '', fullName: '', networkError: storageError(error) };
  }
}

function memberDescription(check: MemberCheck): string {
  if (check.networkError && check.status === 0) {
    return `Could not reach Trello (${check.networkError}).`;
  }
  if (!check.ok) return `Trello rejected the token (HTTP ${check.status}).`;
  const who = [check.username, check.fullName].filter(Boolean).join(', ');
  if (!who) return `OK (HTTP ${check.status}), but the member name could not be read.`;
  return `OK for ${who}.`;
}

async function rememberTokenChoice(): Promise<string> {
  await waitUntilLoaded();
  await ensureEnvironment();
  const stored = readStoredToken();
  const choice = chooseTrelloToken({ stored: stored.token, hash: window.location.hash });
  const described = describeTokenChoice(choice, stored.error);
  let saveDescription = 'No redirect token to save.';
  if (choice.source === 'hash') {
    const writeError = writeStoredToken(choice.token);
    if (writeError) {
      saveDescription = `Failed (${writeError}). The token was left in the page address so a reload can try again.`;
    } else {
      saveDescription = 'Saved.';
      try {
        const cleanUrl = canonicalTrelloReturnUrl(window.location.href);
        window.history.replaceState(null, document.title, cleanUrl);
      } catch (error) {
        info('Error stripping Trello token fragment from URL', error);
        saveDescription = `Saved, but the token is still in the page address (${storageError(error)}).`;
      }
    }
  }
  updateAuthorizationFacts({
    hashDescription: described.hashDescription,
    storedDescription: described.storedDescription,
    saveDescription,
  });
  if (choice.hashPresent || choice.hashError) {
    updateAuthorizationFacts({ trelloReturn: true });
  }
  token = choice.token;
  return choice.token;
}

async function authorize(): Promise<void> {
  info('Authorize started.');
  const found = await rememberTokenChoice();
  if (found) {
    clearAuthAttempt();
    return;
  }
  if (authAttemptPending()) {
    const message = 'Trello came back without a usable token. Staying on the login page instead of redirecting again.';
    updateAuthorizationFacts({ failureStep: message });
    throw new Error(message);
  }
  markAuthAttempt();
  const returnUrl = encodeURIComponent(canonicalTrelloReturnUrl(window.location.href));
  const nextUrl = 'https://api.trello.com/1/authorize'
    + `?return_url=${returnUrl}`
    + '&callback_method=fragment'
    + '&scope=read,write,account'
    + '&expiration=never'
    + '&name=Ault%20Farms%20Apps'
    + `&key=${devKey}`
    + '&response_type=fragment';
  window.location.assign(nextUrl);
}

async function deauthorize(): Promise<void> {
  clearStoredToken();
  clearAuthAttempt();
  token = '';
  await waitUntilLoaded();
}

export async function checkAuthorization(): Promise<boolean> {
  let currentToken = '';
  try {
    currentToken = await rememberTokenChoice();
  } catch (error) {
    info('checkAuthorization: error while loading Trello token', error);
    updateAuthorizationFacts({
      failureStep: `Could not read the Trello token: ${storageError(error)}.`,
    });
    return false;
  }

  if (!currentToken) {
    const inspected = chooseTrelloToken({
      stored: readStoredToken().token,
      hash: window.location.hash,
    });
    const returned = authAttemptPending();
    let failureStep = 'No Trello token is stored in this browser, and the page address has no usable token.';
    if (inspected.hashError) {
      failureStep = `Trello returned an error: ${inspected.hashError}.`;
    } else if (returned) {
      failureStep = 'Trello came back without a usable token. Staying on the login page instead of redirecting again.';
    }
    updateAuthorizationFacts({
      failureStep,
      membersDescription: 'Not called.',
    });
    return false;
  }

  const choice = chooseTrelloToken({
    stored: readStoredToken().token,
    hash: window.location.hash,
  });
  let check = await checkMember(currentToken);
  if (!check.ok && check.status > 0 && choice.source === 'storage' && choice.hashTokenLooksValid) {
    const hashToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') || '';
    clearStoredToken();
    const writeError = writeStoredToken(hashToken);
    check = await checkMember(hashToken);
    token = check.ok ? hashToken : '';
    updateAuthorizationFacts({
      saveDescription: writeError
        ? `The saved token was rejected. The redirect token could not be saved (${writeError}).`
        : 'The saved token was rejected. The redirect token was saved instead.',
    });
    if (check.ok) currentToken = hashToken;
  }

  updateAuthorizationFacts({ membersDescription: memberDescription(check) });
  if (check.ok) {
    token = currentToken;
    clearAuthAttempt();
    updateAuthorizationFacts({ failureStep: '' });
    return true;
  }
  if (check.status > 0) {
    clearStoredToken();
    token = '';
    updateAuthorizationFacts({
      storedDescription: 'removed after Trello rejected it',
    });
  }
  updateAuthorizationFacts({
    failureStep: check.status > 0
      ? `Trello rejected the token (HTTP ${check.status}).`
      : `Could not reach Trello to check the token (${check.networkError}).`,
  });
  return false;
}

export async function describeLivestockAccess(errorMessage: string): Promise<void> {
  const trello = getClient();
  let organizations: string[] = [];
  let organizationFound: OrganizationStatus = 'not checked';
  let livestockBoard: BoardStatus = 'not checked';
  let detail = errorMessage;
  try {
    const orgs = await trello.listOrganizations();
    organizations = orgs.map(org => org.displayName || org.name);
    organizationFound = orgs.some(org => (
      org.displayName === 'Ault Farms' || org.name === 'Ault Farms'
    )) ? 'found' : 'missing';
    const connected = trello.getConnectedOrganization();
    if (connected) {
      try {
        const boards = await trello.get(`/organizations/${connected.id}/boards`, { fields: 'id,name' });
        const names = boards.map(board => board.name).filter(name => name);
        livestockBoard = names.includes('Livestock') ? 'found' : 'missing';
        const visible = names.length ? names.join(', ') : 'none';
        detail = `${errorMessage} Boards visible in ${connected.displayName || connected.name}: ${visible}.`;
      } catch (error) {
        livestockBoard = /board/i.test(errorMessage) ? 'missing' : 'not checked';
        detail = `${errorMessage} Could not list boards (${storageError(error)}).`;
      }
    } else if (/board/i.test(errorMessage)) {
      livestockBoard = 'missing';
    }
  } catch (error) {
    if (/organization/i.test(errorMessage)) organizationFound = 'missing';
    if (/board/i.test(errorMessage)) livestockBoard = 'missing';
    detail = `${errorMessage} Could not list organizations (${storageError(error)}).`;
  }
  noteTrelloAccess({
    organizations,
    organizationFound,
    livestockBoard,
    failureStep: detail,
  });
}

const request: TrelloRequestFunction = async (method, path, params) => {
  await waitUntilLoaded();
  const stringParams: Record<string,string> = {};
  for (const [key,val] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    stringParams[key] = ''+val;
  }
  if (path[0]!== '/') path = '/' + path;
  const url = new URL('https://api.trello.com/1'+path);
  url.searchParams.set('key', devKey);
  url.searchParams.set('token', token);

  const requestInit: RequestInit = {
    method: method.toUpperCase(),
  };

  if (method === 'get' || method === 'delete') {
    for (const [key, value] of Object.entries(stringParams)) {
      url.searchParams.set(key, value);
    }
  } else {
    requestInit.body = new URLSearchParams(stringParams);
  }

  const result = await fetch(url.toString(), requestInit);
  const responseText = await result.text();
  if (!result.ok) {
    let message = `${result.status} ${result.statusText}`;
    if (responseText) {
      try {
        const errorBody = JSON.parse(responseText) as { message?: string };
        if (typeof errorBody.message === 'string' && errorBody.message.trim()) {
          message = `${message}: ${errorBody.message}`;
        }
      } catch (e) {
        void e;
      }
    }
    throw new Error(message);
  }
  if (!responseText) {
    return [];
  }

  // Check if we have a card, list, board, or org:
  let body: unknown;
  try {
    body = JSON.parse(responseText);
  } catch (e) {
    void e;
    throw new Error(`ERROR: request did not return valid JSON for ${method.toUpperCase()} ${path}`);
  }
  if (idLabelsWriteSucceeded(path, body)) return [];
  try { assertTrelloOrgs(body);   return  body;  } catch(e: any) {};
  try { assertTrelloOrg(body);    return [body]; } catch(e: any) {};
  try { assertTrelloBoards(body); return  body;  } catch(e: any) {};
  try { assertTrelloBoard(body);  return [body]; } catch(e: any) {};
  try { assertTrelloLists(body);  return  body;  } catch(e: any) {};
  try { assertTrelloList(body);   return [body]; } catch(e: any) {};
  try { assertTrelloCards(body);  return  body;  } catch(e: any) {};
  try { assertTrelloCard(body);   return [body]; } catch(e: any) {};
  info('ERROR: did not return Org[], Board[], List[], or Card[],  Result was: ', body);
  throw new Error('ERROR: request did not return a valid Trello Org[], Board[], List[], or Card[]')
};

const get: TrelloRESTFunction = async (path,params) => request('get', path, params);
const put: TrelloRESTFunction = async (path,params) => request('put', path, params);
const post: TrelloRESTFunction = async (path,params) => request('post', path, params);
const del: TrelloRESTFunction = async (path,params) => request('delete', path, params);

const _client = getUniversalClient({
  waitUntilLoaded,
  authorize,
  deauthorize,
  request,
  get,
  put,
  post,
  delete: del, // delete is a reserved word
});
export function getClient() { return _client; }