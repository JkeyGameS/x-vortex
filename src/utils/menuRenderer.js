import config from '../config/config.js';
import { toSmallCaps } from './smallCaps.js';
import logger from './logger.js';
import { t } from '../services/localeService.js';
import { getMenu } from '../config/menus/registry.js';
import { getOptionMarker, isOptionAvailable } from './menuFeatureMarkers.js';
import { cardResolvers, bodyResolvers, dashboardResolvers, summaryResolvers, progressResolvers, dynamicSuffixResolvers } from './menuResolvers.js';

function isAdminJid(jid) {
  return Boolean(jid) && Array.isArray(config.adminJids) && config.adminJids.includes(jid);
}

/**
 * Options visible for a user (shared by renderer and router — single source).
 * Hidden options never show; adminOnly needs an admin; hideWhenUnavailable
 * needs its feature to be available.
 */
export function visibleMenuOptions(definition, user) {
  const admin = isAdminJid(user?.jid || user?.sender);
  return (definition.options || []).filter((opt) => {
    if (opt.hidden) return false;
    if (opt.adminOnly && !admin) return false;
    if (opt.hideWhenUnavailable && opt.featureId && !isOptionAvailable(opt.featureId)) return false;
    return true;
  });
}

/**
 * Translate with old-key fallback chain (missing key returns the key itself).
 *
 * Also guards against a key that RESOLVES to a non-string. That happens when a
 * label key and a namespace collide -- menu.group_management.moderation was
 * both a label and the moderation submenu object, and the menu rendered
 * "[object Object]". A non-string is never a usable label, so fall back to the
 * last dotted segment in small caps rather than printing the object.
 */
function tx(lang, key, fallbackKey, params = {}) {
  const pick = (k) => {
    const v = t(lang, k, params);
    if (typeof v === 'string') return v;
    if (v !== undefined && v !== null && typeof v !== 'string') {
      logger.warn({ key: k, lang, type: typeof v }, '[i18n] key resolves to non-string');
      return lastKeySegment(k);
    }
    return k; // missing: the sentinel that triggers the fallback chain
  };

  const primary = pick(key);
  if (primary !== key) return primary;
  if (fallbackKey) {
    const fb = pick(fallbackKey);
    if (fb !== fallbackKey) return fb;
  }
  return primary;
}

/** "menu.group_management.moderation" -> toSmallCaps("moderation") */
function lastKeySegment(key) {
  return toSmallCaps(String(key || '').split('.').pop() || String(key || ''));
}

/**
 * Render a template with {placeholders}: static segments are small-capped,
 * substituted values stay raw (e.g. "@user" keeps its case).
 */
function renderTemplate(template, params = {}) {
  return String(template || '').split(/(\{\w+\})/g).map((part) => {
    const m = part.match(/^\{(\w+)\}$/);
    if (m && params[m[1]] !== undefined) return String(params[m[1]]);
    return toSmallCaps(part);
  }).join('');
}

/**
 * Materialize a definition's options for a user (static list or
 * dynamicOptions builder). Returns a shallow copy with concrete options.
 */
export function materializeDefinition(definition, user, language) {
  if (definition && typeof definition.dynamicOptions === 'function') {
    let resolved = [];
    try {
      resolved = definition.dynamicOptions(user, language) || [];
    } catch {
      resolved = [];
    }
    return { ...definition, options: resolved };
  }
  return definition;
}

/**
 * Push one resolver-owned line exactly like buildMenu does: plain strings are
 * small-capped whole (legacy bodies rely on this for dynamic fragments);
 * {static,dynamic} objects cap only the static part. toSmallCaps is
 * idempotent on already-capped text.
 */
function pushBodyLine(lines, line) {
  if (typeof line === 'string') lines.push(toSmallCaps(line));
  else if (line && typeof line === 'object' && ('static' in line || 'dynamic' in line)) {
    lines.push(toSmallCaps(line.static ?? '') + (line.dynamic ?? ''));
  }
}

/**
 * Render a registered menu to text (no sending).
 * options: { headingParams, prefixLines (verbatim, pre-formatted) }
 * @returns {Promise<{ text: string, options: string[], definition: object }>}
 */
export async function renderMenu(menuId, user, language, options = {}) {
  const raw = getMenu(menuId);
  if (!raw) throw new Error(`menuRenderer: unknown menu '${menuId}'`);
  const definition = materializeDefinition(raw, user, language);
  const lang = language || config.defaultLanguage;
  const displayName = user?.username ? `@${user.username}` : (user?.name || 'User');
  const headingParams = { username: displayName, ...(options.headingParams || {}) };
  const headingTemplate = tx(lang, definition.headingKey, definition.fallbackHeadingKey);
  // Part 1: menus flagged dynamicHeading build their heading from the user
  // record instead of a translation, so the display name can be spliced in
  // raw. Anything without the flag falls through to the original path
  // unchanged.
  const heading = definition.dynamicHeading === true && typeof definition.headingResolver === 'function'
    ? definition.headingResolver(user)
    : `${definition.headingEmoji ? definition.headingEmoji + ' ' : ''}${renderTemplate(headingTemplate, headingParams)}`;
  const lines = [`> *${heading}*`, ''];
  if (Array.isArray(options.prefixLines)) {
    for (const line of options.prefixLines) {
      if (typeof line === 'string') lines.push(line);
      else if (line && typeof line === 'object' && ('static' in line || 'dynamic' in line)) {
        lines.push(toSmallCaps(line.static ?? '') + (line.dynamic ?? ''));
      }
    }
  }
  // Resolvers get (user, language, { sender, chatId }) — fall back to user.jid.
  const resolverCtx = { sender: options.sender || user?.jid || null, chatId: options.chatId || options.sender || user?.jid || null };
  // Dashboard block (e.g. admin panel summary + activity feed).
  if (definition.dashboardResolver && typeof dashboardResolvers[definition.dashboardResolver] === 'function') {
    const dashLines = await dashboardResolvers[definition.dashboardResolver](user, lang, resolverCtx);
    for (const line of Array.isArray(dashLines) ? dashLines : []) pushBodyLine(lines, line);
  }
  // Card block (verbatim resolver-owned lines, e.g. profile user info).
  if (definition.cardResolver && typeof cardResolvers[definition.cardResolver] === 'function') {
    const cardLines = await cardResolvers[definition.cardResolver](user, lang, resolverCtx);
    for (const line of Array.isArray(cardLines) ? cardLines : []) pushBodyLine(lines, line);
  }
  // Summary block (short dynamic block, e.g. user counts).
  if (definition.summaryResolver && typeof summaryResolvers[definition.summaryResolver] === 'function') {
    const summaryLines = await summaryResolvers[definition.summaryResolver](user, lang, resolverCtx);
    for (const line of Array.isArray(summaryLines) ? summaryLines : []) pushBodyLine(lines, line);
  }
  // Body menus own their full layout (resolver copied 1:1 from legacy code).
  if (definition.bodyResolver && typeof bodyResolvers[definition.bodyResolver] === 'function') {
    const bodyLines = await bodyResolvers[definition.bodyResolver](user, lang, resolverCtx);
    for (const line of Array.isArray(bodyLines) ? bodyLines : []) pushBodyLine(lines, line);
    return { text: lines.join('\n'), options: [], definition };
  }
  const showMarkers = definition.showMarkers !== false;
  const suffixOf = (opt) => {
    if (!opt.dynamicSuffix) return '';
    const resolver = dynamicSuffixResolvers[opt.dynamicSuffix];
    if (typeof resolver !== 'function') return '';
    try {
      return String(resolver(user, lang, opt) || '');
    } catch {
      return '';
    }
  };
  const progressOf = async (opt) => {
    if (!opt.progressId || !definition.progressResolver) return '';
    const resolver = progressResolvers[definition.progressResolver];
    if (typeof resolver !== 'function') return '';
    try {
      const prefix = await resolver(user, lang, opt.progressId);
      return prefix ? String(prefix) + ' ' : '';
    } catch {
      return '';
    }
  };
  const renderedOptions = [];
  for (const opt of visibleMenuOptions(definition, user)) {
    // 'separatorBefore' is the canonical flag; 'breakBefore' is kept as an
    // alias so any existing definition using it renders identically.
    if (opt.separatorBefore || opt.breakBefore) lines.push('');
    const marker = showMarkers ? getOptionMarker(opt.featureId) : '';
    const labelTemplate = tx(lang, opt.labelKey, opt.fallbackKey);
    // Legacy buildMenu caps the whole line (labels AND suffixes); markers
    // and emojis are unaffected by casing. Placeholder values substituted
    // above are capped too, exactly like the legacy pipeline.
    const bodyText = toSmallCaps(renderTemplate(labelTemplate, headingParams) + suffixOf(opt));
    const line = `${toSmallCaps(String(opt.number))}. ${await progressOf(opt)}${opt.emoji ? opt.emoji + ' ' : ''}${bodyText}${marker ? ' ' + marker : ''}`;
    lines.push(line);
    renderedOptions.push(line);
    // Appended sub-lines (e.g. per-user notes under an option). Capped like
    // buildMenu does; pre-capped content is idempotent.
    if (Array.isArray(opt.appendLines)) {
      for (const sub of opt.appendLines) {
        if (typeof sub === 'string') lines.push(toSmallCaps(sub));
        else pushBodyLine(lines, sub);
      }
    }
  }
  if (definition.backTo !== null && definition.backTo !== undefined) {
    lines.push('');
    lines.push(`0. ${toSmallCaps(t(lang, definition.backLabelKey || 'common.back'))}`);
  }
  // footerKey: null suppresses the footer row entirely (legacy menus
  // without footers, e.g. snippets). footerItalic: false preserves legacy
  // plain footers (e.g. main menu).
  if (definition.footerKey !== null) {
    const footerKey = definition.footerKey || 'admin.replyPrompt';
    const footerTemplate = tx(lang, footerKey, definition.fallbackFooterKey);
    const footerText = renderTemplate(footerTemplate, headingParams);
    lines.push('');
    lines.push(definition.footerItalic === false ? footerText : `_${footerText}_`);
  }
  return { text: lines.join('\n'), options: renderedOptions, definition };
}
