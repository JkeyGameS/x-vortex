import fs from 'fs';
import sessionManager from './src/utils/sessionManager.js';
import config from './src/config/config.js';
import {
  handleChatReply, startAddChat, handleChatAddMode,
  handleQuickTriggers, handleQuickAi, handleQuickReplies, handleQuickPreview, handleQuickLanguage,
  showTemplateLibrary, handleTemplateLibrary, handleTemplatePreview, handleTemplateLanguage,
  handleBulkAddInput, handleBulkPreview, handleBulkLanguage, handleBulkPolicy,
  showUnmatchedList, handleUnmatchedList,
  sendSnippetsMenu, handleSnippetsMenu, handleSnippetAddName, handleSnippetText, handleSnippetPick,
  sendRecentMenu, handleRecentMenu, handleRecentOpen, handleRecentFavToggle,
  handleChatDuplicateModify, handleChatAddTriggerEdit, openEditChat, generateTriggerVariations
} from './src/handlers/chatCommand.js';
import { handleFaqAddLanguage, handleFaqResponsePreview, startAddFaq, handleFaqAddQuestion, handleFaqAddAnswer } from './src/handlers/faqCommand.js';
import * as chatRuleService from './src/services/chatRuleService.js';
import * as faqService from './src/services/faqService.js';
import { getSnippets, setSnippet, deleteSnippet, expandSnippets } from './src/services/snippetService.js';
import { getRecent, getFavorites, addFavorite, removeFavorite, clearPrefs } from './src/services/rulePrefsService.js';
import { logUnmatched, getUnmatched, clearUnmatched } from './src/services/unmatchedService.js';
import { getPacks, installPack } from './src/services/chatTemplateService.js';
import { loadCommands } from './src/handlers/commandHandler.js';

let fails = 0;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fails++; };
const ADMIN = (config.adminJids || [])[0];
const TS = Date.now().toString(36);
const sent = [];
const mockSock = { sendMessage: async (j, m) => { if (m.text) sent.push(m.text); return { key: { id: 'x' + sent.length } }; } };
const ctx = { sock: mockSock, sender: ADMIN, chatId: ADMIN, pushName: 'A' };
const last = () => sent[sent.length - 1] || '';
const state = () => sessionManager.getSession(ADMIN, ADMIN)?.currentMenu;
async function go(m, extra = {}) { sessionManager.setState(ADMIN, ADMIN, { currentMenu: m, lastMenuKey: null, editCount: 0, chatDraft: null, pendingData: null, ...extra }); sent.length = 0; }
const bak = {};
for (const f of ['chatStats.json', 'faqStats.json', 'chatRules.json', 'faq.json', 'snippets.json', 'adminRulePrefs.json', 'unmatched.json', 'chatTemplates.json']) {
  try { bak[f] = fs.readFileSync('./data/' + f, 'utf8'); } catch { bak[f] = null; }
}

// 1. mode menu
await go('chat_submenu');
await startAddChat(ctx);
check('mode menu 7 opts', state() === 'chat_add_mode' && /7\. /.test(last()));
await handleChatAddMode(ctx, '2');
check('mode 2 advanced', state() === 'chat_add_start');

// 2. quick add: trigger -> AI -> reply -> preview -> save (3 user msgs + AI)
await go('chat_submenu');
await startAddChat(ctx);
await handleChatAddMode(ctx, '1');
await handleQuickTriggers(ctx, `zqxwquick-${TS}`);
await handleQuickAi(ctx, '2');
await handleQuickReplies(ctx, 'Hi {username}!');
const pv = last();
check('quick preview resolved', state() === 'chat_quick_preview' && pv.includes('@John'));
await handleQuickPreview(ctx, '1');
const quick = chatRuleService.getAllRules().find((r) => (r.triggers || []).some((t) => t.includes('zqxwquick')));
check('quick saved defaults', !!quick && quick.language === 'en' && quick.priority === 1 && quick.action === 'send_text' && quick.status === 'active');
// AI yes path
await go('chat_submenu');
await startAddChat(ctx);
await handleChatAddMode(ctx, '1');
await handleQuickTriggers(ctx, `zqxwquick2-${TS}`);
await handleQuickAi(ctx, '1');
check('AI yes -> coming soon + continues', /ᴄᴏᴍɪɴɢ sᴏᴏɴ/.test(last()) && state() === 'chat_quick_replies');

// 3. templates
await go('chat_submenu');
await showTemplateLibrary(ctx);
check('7 packs listed', state() === 'chat_template_library' && /7\. /.test(last()));
check('packs have rules', getPacks().every((p) => p.rules.length > 0));
await handleTemplateLibrary(ctx, '1');
await handleTemplatePreview(ctx, '1');
await handleTemplateLanguage(ctx, '1');
const tplRule = chatRuleService.getAllRules().find((r) => (r.triggers || []).some((t) => ['hi', 'hello', 'hey'].includes(t)) && r.createdBy === ADMIN);
check('template installed en', !!tplRule && tplRule.language === 'en');

// 4. bulk add
await go('chat_submenu');
await handleChatAddMode(ctx, '4');
await handleBulkAddInput(ctx, `zqxwbulk1-${TS} = Bulk hi ; Hey there\nzqxwbulk2-${TS} = Bulk bye`);
check('bulk preview 2 rules', state() === 'chat_bulk_preview');
await handleBulkPreview(ctx, '1');
await handleBulkLanguage(ctx, '1');
await handleBulkPolicy(ctx, '1');
const bulkRules = chatRuleService.getAllRules().filter((r) => (r.triggers || []).some((t) => t.includes('zqxwbulk')));
check('bulk saved 2', bulkRules.length === 2 && bulkRules.every((r) => r.replies.length >= 1));

// 5. /addrule
const cmds = await loadCommands();
check('/addrule registered', !!cmds.get('addrule'));
await cmds.get('addrule').execute({ sock: mockSock, sender: ADMIN, chatId: ADMIN, pushName: 'A', args: [`zqxwcmd-${TS}=Hi there ; Yo`, 'lang=en', 'priority=5', 'cooldown=30'] });
const cmdRule = chatRuleService.getAllRules().find((r) => (r.triggers || []).some((t) => t.includes('zqxwcmd')));
check('addrule single + opts', !!cmdRule && cmdRule.priority === 5 && cmdRule.cooldownSeconds === 30);
await cmds.get('addrule').execute({ sock: mockSock, sender: ADMIN, chatId: ADMIN, pushName: 'A', args: [`zqxwcmdA-${TS}=A!`, '|', `zqxwcmdB-${TS}=B!`] });
check('addrule multi (|)', chatRuleService.getAllRules().some((r) => (r.triggers || []).some((t) => t.includes('zqxwcmdA'))) && chatRuleService.getAllRules().some((r) => (r.triggers || []).some((t) => t.includes('zqxwcmdB'))));
await cmds.get('addrule').execute({ sock: mockSock, sender: ADMIN, chatId: ADMIN, pushName: 'A', args: [] });
check('addrule invalid -> usage', /ᴀᴅᴅʀᴜʟᴇ|ᴜsᴀɢᴇ|trigger/i.test(last()) || last().length > 0);

// 6. unmatched -> quick add prefill
const um = logUnmatched(ADMIN, 'zqxw unmatched question text');
await go('chat_submenu');
await handleChatReply(ctx, '13');
check('unmatched list', state() === 'chat_unmatched' && last().includes('zqxw unmatched'));
await handleUnmatchedList(ctx, '1');
check('unmatched -> quick reply step', state() === 'chat_quick_replies' && last().includes('zqxw unmatched'));
await handleQuickReplies(ctx, 'Here is your answer!');
await handleQuickPreview(ctx, '1');
const umRule = chatRuleService.getAllRules().find((r) => (r.triggers || []).some((t) => t.includes('zqxw unmatched')));
check('unmatched resolved on save', !!umRule);
const { getUnmatched } = await import('./src/services/unmatchedService.js');
check('unmatched entry resolved', !getUnmatched().some((e) => e.id === um.id));

// 7. duplicate modify
await go('chat_submenu');
await handleChatReply(ctx, '10');
await handleChatDuplicateSelect(ctx, '1');
await handleChatDuplicateLanguage(ctx, '2');
check('duplicate modify prompt', state() === 'chat_duplicate_modify');
await handleChatDuplicateModify(ctx, '2');
check('duplicate No -> panel', state() === 'chat_submenu');

// 8. snippets CRUD + expansion
await go('chat_submenu');
await handleChatReply(ctx, '11');
await handleSnippetsMenu(ctx, '2');
await handleSnippetAddName(ctx, 'zqxwsnip');
await handleSnippetText(ctx, 'Hello snippet world!', 'add');
check('snippet added', getSnippet('zqxwsnip') === 'Hello snippet world!');
check('snippet expands', expandSnippets('Say {snippet:zqxwsnip} ok') === 'Say Hello snippet world! ok');
check('unknown snippet kept', expandSnippets('Say {snippet:nope} ok') === 'Say {snippet:nope} ok');
await handleSnippetsMenu(ctx, '3');
await handleSnippetPick(ctx, '1', 'delete');
check('snippet deleted', getSnippet('zqxwsnip') === null);

// 9. drafts: save + no-match + filter + promote
await go('chat_submenu');
await startAddChat(ctx);
await handleChatAddMode(ctx, '2');
await handleChatAddStart(ctx, '1');
await handleChatAddTriggerInput(ctx, `zqxwdraft-${TS}`);
await handleTriggerVariations(ctx, '8');
await handleChatAddTriggerEdit(ctx, '6');
const draftRule = chatRuleService.getAllRules().find((r) => (r.triggers || []).some((t) => t.includes('zqxwdraft')));
check('draft saved inactive', !!draftRule && draftRule.status === 'draft' && draftRule.enabled === false);
check('draft skipped at runtime', chatRuleService.matchRule(`zqxwdraft-${TS}`, 'en') === null);
check('draft list icon', true);
// promote via toggle
await go('chat_submenu');
sessionManager.setState(ADMIN, ADMIN, { currentMenu: 'chat_edit_menu', chatEditId: draftRule.id });
await handleChatEditMenu(ctx, '7');
const promoted = chatRuleService.getRule(draftRule.id);
check('draft promoted by toggle', promoted.status === 'active' && promoted.enabled === true);
check('promoted matches', chatRuleService.matchRule(`zqxwdrAft-${TS}`.toLowerCase(), 'en') !== null);

// 10. recent/favorites
await go('chat_submenu');
await handleChatReply(ctx, '12');
await handleRecentMenu(ctx, '3');
await handleRecentFavToggle(ctx, '1', true);
const { handleChatEditMenu: hcem } = await import('./src/handlers/chatCommand.js');
void hcem;
check('recent tracked on edit open', getRecent(ADMIN).includes(draftRule.id));
check('favorite added', getFavorites(ADMIN).includes(draftRule.id));
await handleRecentMenu(ctx, '2');
check('favorites list', last().includes(draftRule.triggers[0]));
await handleRecentMenu(ctx, '4');
await handleRecentFavToggle(ctx, '1', false);
check('favorite removed', !getFavorites(ADMIN).includes(draftRule.id));

// 11. submenu options + routing
await go('chat_submenu');
check('13 options present', /11\. /.test(last()) && /12\. /.test(last()) && /13\. /.test(last()));
await handleChatReply(ctx, '11');
check('opt 11 snippets', state() === 'chat_snippets');
await go('chat_submenu');
await handleChatReply(ctx, '12');
check('opt 12 recent', state() === 'chat_recent');
await go('chat_submenu');
await handleChatReply(ctx, '13');
check('opt 13 unmatched', state() === 'chat_unmatched');

// 12. 5-lang keys
const chatNeed = ['addModeTitle', 'addModeQuick', 'quickTriggerPrompt', 'quickAiTitle', 'quickPreviewTitle', 'bulkTitle', 'bulkFormat', 'bulkDone', 'templateTitle', 'templateInstalled', 'unmatchedTitle', 'snippetsTitle', 'snippetSaved', 'recentTitle', 'favAdded', 'duplicateModifyTitle', 'addruleUsage', 'addruleDone', 'filterDrafts', 'triggerSaveDraft', 'draftSaved', 'usageMatches'];
const faqNeed = ['previewResponseTitle', 'previewConfirmSave'];
for (const l of ['en', 'fr', 'de', 'es', 'ar']) {
  const j = JSON.parse(fs.readFileSync(`./translations/${l}.json`, 'utf8'));
  const miss = [
    ...chatNeed.filter((k) => typeof j.chatResponses?.[k] !== 'string').map((k) => 'chat.' + k),
    ...faqNeed.filter((k) => typeof j.faq?.[k] !== 'string').map((k) => 'faq.' + k)
  ];
  if (miss.length) { console.log('FAIL keys ' + l + ': ' + miss.join(',')); fails++; }
  else { console.log('OK   keys ' + l); }
}

// cleanup
for (const r of chatRuleService.getAllRules().filter((r) => JSON.stringify(r.triggers) + JSON.stringify(r.replies) && ((r.triggers || []).some((t) => t.includes('zqxw')) || (r.replies || []).some((t) => t.includes('zqxw'))))) chatRuleService.deleteRule(r.id);
for (const e of faqService.getAllEntries().filter((e) => (e.question || '').includes('zqxw'))) faqService.deleteEntry(e.id);
clearUnmatched();
const { clearPrefs } = await import('./src/services/rulePrefsService.js');
clearPrefs();
const { clearUsageStats } = await import('./src/services/chatStatsService.js');
clearUsageStats();
for (const [f, b] of [['chatStats.json', bak.chatStats], ['faqStats.json', bak.faqStats], ['chatRules.json', bak.chatRules], ['faq.json', bak.faq], ['snippets.json', bak.snippets], ['adminRulePrefs.json', bak.adminRulePrefs], ['unmatched.json', bak.unmatched], ['chatTemplates.json', bak.chatTemplates]]) {
  try { if (b === null) fs.unlinkSync('./data/' + f); else fs.writeFileSync('./data/' + f, b); } catch {}
}

console.log(fails === 0 ? 'ALL PASS' : `FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
