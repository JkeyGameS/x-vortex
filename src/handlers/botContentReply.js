// Bot Content & Timing sub-states.
//
// The menus themselves resolve through the config-driven cluster; anything that
// needs free text (editing a field, confirming, importing JSON, picking a
// snapshot) parks the session in a bot_content_* pendingAction and is drained
// here, in one place.
import sessionManager from '../utils/sessionManager.js';
import { logAdminAction } from '../services/adminLogService.js';
import { getContent, setContent, snapshot } from '../services/botContentService.js';

export async function handleBotContentReply(context, session) {
  const { sock, sender, chatId, trimmedText } = context;
  const m = await import('./botContentCommand.js');
  const action = session.pendingAction;
  const input = String(trimmedText ?? '').trim();
  const st = (patch) => sessionManager.setState(sender, chatId, patch);

  switch (action) {
    // Admin typed the replacement text for a field.
    case 'bot_content_field_input': {
      if (input === '0') { st({ pendingAction: null, pendingData: null }); return m.showGroupMenu(context, session.pendingData?.path?.split('.')[1]); }
      sessionManager.setState(sender, chatId, {
        pendingAction: 'bot_content_field_confirm',
        pendingData: { ...(session.pendingData || {}), draft: input, oldValue: getContent(session.pendingData?.path) }
      });
      const fresh = { ...context, pendingData: session.pendingData };
      return m.confirmFieldEdit(fresh, { ...session, pendingData: { ...session.pendingData, draft: input } });
    }

    // Preview -> save / edit again / cancel.
    case 'bot_content_field_confirm': {
      if (input === '1' || input === 'y' || input === 'yes' || input === '\u2705') {
        return m.applyFieldEdit(context, session);
      }
      if (input === '2') {
        return m.showFieldEditor(context, session.pendingData?.path);
      }
      // 3 and anything else: cancel back to the group list.
      st({ pendingAction: null, pendingData: null });
      return m.showGroupMenu(context, session.pendingData?.path?.split('.')[1]);
    }

    // Pick which variant of a welcome-back pool to edit.
    case 'bot_content_variant_pick': {
      const { variant } = session.pendingData || {};
      if (input === '0') { st({ pendingAction: null, pendingData: null }); return true; }
      const index = Number(input) - 1;
      const pool = getContent(`welcomeBack.${variant}`);
      if (!Number.isInteger(index) || index < 0 || !Array.isArray(pool) || index >= pool.length) {
        return m.showVariantEditor(context, variant);
      }
      sessionManager.setState(sender, chatId, {
        pendingAction: 'bot_content_variant_input',
        pendingData: { variant, index }
      });
      return m.showVariantInput(context, variant, index);
    }

    case 'bot_content_variant_input': {
      const { variant, index } = session.pendingData || {};
      if (input === '0') { st({ pendingAction: null, pendingData: null }); return m.showVariantEditor(context, variant); }
      const pool = Array.isArray(getContent(`welcomeBack.${variant}`)) ? [...getContent(`welcomeBack.${variant}`)] : [];
      if (index < 0 || index >= pool.length) return m.showVariantEditor(context, variant);
      const oldValue = pool[index];
      pool[index] = input;
      sessionManager.setState(sender, chatId, {
        pendingAction: 'bot_content_variant_confirm',
        pendingData: { variant, index, draft: input, oldValue }
      });
      return m.confirmVariantEdit(context, session.pendingData);
    }

    case 'bot_content_variant_confirm': {
      const { variant, index, draft, oldValue } = session.pendingData || {};
      if (input === '1' || input === 'y' || input === 'yes' || input === '\u2705') {
        const pool = [...getContent(`welcomeBack.${variant}`)];
        pool[index] = draft;
        snapshot();
        setContent(`welcomeBack.${variant}`, pool, sender);
        logAdminAction(sender, 'bot_content_edit', JSON.stringify({ path: `welcomeBack.${variant}[${index}]`, oldValue, newValue: draft }));
        st({ pendingAction: null, pendingData: null });
        return m.showVariantEditor(context, variant);
      }
      if (input === '2') return m.showVariantInput(context, variant, index);
      st({ pendingAction: null, pendingData: null });
      return m.showVariantEditor(context, variant);
    }

    // Timing scalar.
    case 'bot_content_timing_input': {
      const { key, path } = session.pendingData || {};
      if (input === '0') { st({ pendingAction: null, pendingData: null }); return true; }
      const current = getContent(path);
      let value = input;
      if (typeof current === 'boolean') {
        if (!/^(0|1|true|false|on|off|yes|no)$/i.test(input)) return m.botContentTimingValue(context, key);
        value = /^(1|true|on|yes)$/i.test(input);
      } else if (typeof current === 'number') {
        value = Number(input);
        if (!Number.isFinite(value)) return m.botContentTimingValue(context, key);
      }
      const oldValue = current;
      snapshot();
      setContent(path, value, sender);
      logAdminAction(sender, 'bot_content_edit', JSON.stringify({ path, oldValue, newValue: value }));
      st({ pendingAction: null, pendingData: null });
      return m.botContentTimingValue(context, key);
    }

    // Per-language name/flag.
    case 'bot_content_language_pick': {
      const { code } = session.pendingData || {};
      if (input === '0') { st({ pendingAction: null, pendingData: null }); return true; }
      if (input === '1') {
        sessionManager.setState(sender, chatId, {
          pendingAction: 'bot_content_language_name',
          pendingData: { code }
        });
        return m.showLanguageField(context, code, 'name');
      }
      if (input === '2') {
        sessionManager.setState(sender, chatId, {
          pendingAction: 'bot_content_language_flag',
          pendingData: { code }
        });
        return m.showLanguageField(context, code, 'flag');
      }
      return m.botContentLanguageEditor(context, code);
    }

    case 'bot_content_language_name':
    case 'bot_content_language_flag': {
      const { code } = session.pendingData || {};
      const isFlag = action.endsWith('flag');
      if (input === '0') { st({ pendingAction: null, pendingData: null }); return m.botContentLanguageEditor(context, code); }
      const path = `languageDisplay.languages.${code}.${isFlag ? 'flag' : 'name'}`;
      const oldValue = getContent(path);
      snapshot();
      setContent(path, input, sender);
      logAdminAction(sender, 'bot_content_edit', JSON.stringify({ path, oldValue, newValue: input }));
      st({ pendingAction: null, pendingData: null });
      return m.botContentLanguageEditor(context, code);
    }

    // Import: waiting for pasted JSON or a document.
    case 'bot_content_import':
      return m.botContentImport(context, session, input, context.documentBuffer);

    // Snapshots: pick one to restore, or 'd' to delete.
    case 'bot_content_snapshot_pick': {
      if (input === '0') { st({ pendingAction: null, pendingData: null }); return true; }
      const wantsDelete = /^d/i.test(input);
      const index = Number(wantsDelete ? input.slice(1) : input) - 1;
      return m.botContentSnapshotAction(context, session, index, wantsDelete);
    }

    // Reset: pick a section, then confirm.
    case 'bot_content_reset_pick':
      return m.botContentResetConfirm(context, session, Number(input) - 1);

    case 'bot_content_reset_confirm':
      if (input === '1' || input === 'y' || input === 'yes' || input === '\u2705') {
        return m.botContentResetApply(context, session);
      }
      return m.botContentResetMenu(context);

    default:
      return false;
  }
}

/** True when the session is parked in one of the states above. */
export function isBotContentState(session) {
  const a = session?.pendingAction;
  return typeof a === 'string' && a.startsWith('bot_content_');
}