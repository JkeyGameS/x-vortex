// Default editable bot content (Admin Content & Timing Editor).
//
// Stored as PLAIN TEXT, not pre-rendered small caps. The editor is far more
// usable when an admin sees normal-cased source, and resolvePlaceholders() caps
// only the static fragments around each placeholder. toSmallCaps is idempotent,
// so an admin who pastes already-capped text still gets exactly what they
// typed, and dynamic values (pushName, language name) are never touched.
//
// The prompt's draft of this file pre-rendered small caps using U+A731
// (ꜱ) for "s". This bot's own toSmallCaps maps "s" to a plain "s", so those
// defaults would have changed how every "s" in the bot looks. The wording is
// the prompt's; only the glyph convention differs.
export default {
  version: 1,
  updatedAt: null,
  updatedBy: null,

  onboarding: {
    firstMessage: {
      // The name keeps its bold markers, matching the pre-editor output. An
      // admin can drop them if they want a plainer line.
      greeting: '{timeOfDay} *{pushName}* 👋🏼',
      detectedLine: '🌐 I detected your device language is *{languageName} {languageFlag}*.',
      languagesPreview: 'Languages available: 🇬🇧 🇫🇷 🇩🇪 🇪🇸 🇸🇦',
      question: 'Would you like me to do this as your language?',
      option1: '✅ Yes, use {languageName} {languageFlag}',
      option2: '🌐 Choose a different language',
      notSupportedHint: 'Language not supported? Reply 2 to pick another.',
      replyHint: 'Reply with a number, or type yes / no.'
    },

    resumeMessage: {
      headingShort: 'Still there?',
      bodyShort: '{pushName}, we were this close! Ready to continue?',
      headingLong: 'Welcome back',
      bodyLong: "{pushName}, it's been a while! Ready to pick up where we left off?",
      optionYes: "Yes, let's continue",
      optionNo: 'No, not now',
      replyHint: 'Reply with a number.',
      resumeYesHeading: 'Language',
      resumeYesDetectedLine: 'I detected your device language is *{languageName} {languageFlag}*.',
      resumeNoHeading: 'Alright',
      resumeNoBody: "No worries, {pushName}. I'll be here when you're ready.",
      resumeNoHint: 'Send any message to resume.',
      unclearAttempt1: 'Just checking — ready to continue?',
      unclearAttempt2: 'Hmm, I only need a quick yes or no.',
      unclearAttempt3: "Take your time — reply *yes* or *no* when you're ready."
    },

    welcomeMessage: {
      heading: '🎉 Welcome to {botName}',
      body: "You're all set, {pushName}!\n\nHere are a few things you can do:\n\n· 👤 Manage your profile\n· ⚙️ Customize settings\n· 📊 View your stats\n· 📮 Send feedback\n\nLet's get started!"
    },

    unsupportedLanguage: {
      message: "🌐 Your device language (*{detectedRaw}*) isn't supported yet.\n\nPlease choose one of the following:"
    },

    retry: {
      attempt1: "😅 Sorry, I didn't get that. Please reply *yes* or *no*.",
      attempt2: "🤔 I only understand *yes* or *no*. Can you try again?",
      attempt3: "😕 That didn't look like a *yes* or *no*. One more try?"
    },

    cooldownLock: {
      heading: '⏳ Please come back later',
      body: "You've sent too many unclear replies.\n\nI'll be here again in {minutes} minutes."
    }
  },

  welcomeBack: {
    A1: [
      "Hey {pushName}, let's finish setting up!",
      '{pushName}, we were this close! Ready to continue?',
      "Still there, {pushName}? Let's finish this!"
    ],
    A2: [
      "Hey {pushName}, good to see you again!\n\nLet's continue where we left off.",
      'Welcome back, {pushName}! Pick up where you left.'
    ],
    A3: [
      'Hey {pushName}, ready to finish the setup?',
      "Welcome back, {pushName}. Let's wrap this up!"
    ],
    A4: [
      "Wow {pushName}, it's been a while! Let's get you started.",
      'Welcome back, {pushName}! Better late than never.'
    ],
    B1: [
      'Hey {pushName}, great to see you again!',
      'Welcome back, {pushName}!'
    ],
    B2: [
      'Hey {pushName}, nice to see you again!',
      'Welcome back, {pushName}!'
    ],
    B3: [
      "Welcome back {pushName}! Hope you're doing well.",
      "Long time no see, {pushName}! Glad you're back."
    ]
  },

  timing: {
    typingIndicatorEnabled: true,
    typingMode: 'adaptive',
    typingDelayMs: 600,
    typingAdaptivePerCharMs: 15,
    typingAdaptiveMinMs: 200,
    typingAdaptiveMaxMs: 2500,
    typingTargeting: {
      mainMenu: true,
      submenuTransitions: true,
      chatReplies: true,
      confirmations: false,
      errors: false
    },
    welcomeBackThresholds: {
      minGapMs: 300000,
      shortGapMs: 3600000,
      dayGapMs: 86400000,
      weekGapMs: 604800000
    },
    cooldownLockMs: 300000,
    onboardingRetryMaxAttempts: 3,

    // Idle-then-hint. After a chat reply or a welcome-back the bot waits this
    // long for the user to go quiet, then suggests /start instead of pushing
    // the main menu. These are runtime strings, deliberately not translations:
    // the Bot Content editor owns them.
    startHintEnabled: true,
    startHintDelayMs: 60000,
    startHintCooldownMs: 600000,
    startHintSuppressDuringOnboarding: true,
    startHintSuppressDuringWizard: true,
    startHintText: '💡 Want to see the menu? Send /start.',
    startHintTextAfterWelcomeBack: "💡 Welcome back! Send /start when you're ready.",
    startHintQuietHoursEnabled: false,
    startHintQuietHoursStart: '23:00',
    startHintQuietHoursEnd: '07:00'
  },

  languageDisplay: {
    smallCapsEnabled: true,
    languages: {
      en: { name: 'English', flag: '🇬🇧' },
      fr: { name: 'Français', flag: '🇫🇷' },
      de: { name: 'Deutsch', flag: '🇩🇪' },
      es: { name: 'Español', flag: '🇪🇸' },
      ar: { name: 'العربية', flag: '🇸🇦' }
    }
  },

  // Group welcome/goodbye (Group Management Phase 3). Stored in normal case:
  // resolvePlaceholders applies toSmallCaps to the static fragments at render,
  // matching every other section in this file.
  groupMessages: {
    welcome: '👋 Welcome {pushName}!\n\nYou joined *{groupName}* (member #{memberCount}).\n\nType /help for more.',
    goodbye: '👋 Goodbye {pushName}!\n\nWe will miss you in *{groupName}*.'
  }
};