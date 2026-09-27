import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { addRule, getAllRules, deleteRule } from './chatRuleService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const BUILTIN_FILE = path.join(DATA_DIR, 'builtinTemplates.json');
const CUSTOM_FILE = path.join(DATA_DIR, 'customTemplates.json');

export const TEMPLATE_LANGUAGES = ['en', 'fr', 'de', 'es', 'ar'];

export const TEMPLATE_CATEGORIES = [
  { id: 'greetings_social', nameKey: 'templates.catGreetingsSocial', emoji: '👋' },
  { id: 'politeness', nameKey: 'templates.catPoliteness', emoji: '🙏' },
  { id: 'help_info', nameKey: 'templates.catHelpInfo', emoji: '❓' },
  { id: 'emotion', nameKey: 'templates.catEmotion', emoji: '😊' },
  { id: 'occasions', nameKey: 'templates.catOccasions', emoji: '🎉' },
  { id: 'professional', nameKey: 'templates.catProfessional', emoji: '💼' },
  { id: 'onboarding', nameKey: 'templates.catOnboarding', emoji: '🚀' },
  { id: 'multilang', nameKey: 'templates.catMultilang', emoji: '🌍' },
  { id: 'fun', nameKey: 'templates.catFun', emoji: '🎮' },
  { id: 'misc', nameKey: 'templates.catMisc', emoji: '🔧' },
  { id: 'small_talk', nameKey: 'templates.catSmallTalk', emoji: '💬' }
];

// Pack definitions: nameKey points at translations (plain label, no emoji),
// emoji/category/version live here. Rule replies are per-language objects.
const DEFAULT_BUILTINS = {
  greetings: {
    version: 1, nameKey: 'templates.packGreetings', emoji: '👋', category: 'greetings_social',
    rules: [
      {
        triggers: ['hi', 'hello', 'hey'],
        replies: {
          en: ['Hi {username}! 👋', 'Hello {username}!'],
          fr: ['Salut {username} ! 👋', 'Bonjour {username} !'],
          de: ['Hallo {username}! 👋', 'Hi {username}!'],
          es: ['¡Hola {username}! 👋', '¡Hey {username}!'],
          ar: ['مرحبًا {username}! 👋', 'أهلاً {username}!']
        }
      },
      {
        triggers: ['hello there', 'hey there'],
        replies: {
          en: ['Hey there {username}! 😊'],
          fr: ['Salut {username} ! 😊'],
          de: ['Hallo {username}! 😊'],
          es: ['¡Hola {username}! 😊'],
          ar: ['أهلاً {username}! 😊']
        }
      }
    ]
  },
  time_greetings: {
    version: 1, nameKey: 'templates.packTimeGreetings', emoji: '🌅', category: 'greetings_social',
    rules: [
      {
        triggers: ['good morning'],
        replies: {
          en: ['Good morning {username}! ☀️'],
          fr: ['Bonjour {username}, bonne matinée ! ☀️'],
          de: ['Guten Morgen {username}! ☀️'],
          es: ['¡Buenos días {username}! ☀️'],
          ar: ['صباح الخير {username}! ☀️']
        }
      },
      {
        triggers: ['good afternoon'],
        replies: {
          en: ['Good afternoon {username}! 🌤️'],
          fr: ['Bon après-midi {username} ! 🌤️'],
          de: ['Guten Tag {username}! 🌤️'],
          es: ['¡Buenas tardes {username}! 🌤️'],
          ar: ['مساء الخير {username}! 🌤️']
        }
      },
      {
        triggers: ['good evening'],
        replies: {
          en: ['Good evening {username}! 🌙'],
          fr: ['Bonsoir {username} ! 🌙'],
          de: ['Guten Abend {username}! 🌙'],
          es: ['¡Buenas noches {username}! 🌙'],
          ar: ['مساء الخير {username}! 🌙']
        }
      },
      {
        triggers: ['good night'],
        replies: {
          en: ['Good night {username}! 🌙'],
          fr: ['Bonne nuit {username} ! 🌙'],
          de: ['Gute Nacht {username}! 🌙'],
          es: ['¡Buenas noches {username}! 🌙'],
          ar: ['تصبح على خير {username}! 🌙']
        }
      }
    ]
  },
  how_are_you: {
    version: 1, nameKey: 'templates.packHowAreYou', emoji: '🤝', category: 'greetings_social',
    rules: [
      {
        triggers: ['how are you'],
        replies: {
          en: ["I'm doing great, {username}! How about you? 😊"],
          fr: ['Je vais très bien, {username} ! Et toi ? 😊'],
          de: ['Mir geht es super, {username}! Und dir? 😊'],
          es: ['¡Estoy genial, {username}! ¿Y tú? 😊'],
          ar: ['أنا بخير {username}! وأنت؟ 😊']
        }
      },
      {
        triggers: ["how's it going", 'hows it going'],
        replies: {
          en: ["All good here, {username}! What's up with you? 😎"],
          fr: ['Tout va bien ici, {username} ! Quoi de neuf ? 😎'],
          de: ['Alles gut hier, {username}! Was gibt es Neues? 😎'],
          es: ['Todo bien por aquí, {username}. ¿Qué hay de nuevo? 😎'],
          ar: ['كل شيء بخير {username}! ما الجديد؟ 😎']
        }
      },
      {
        triggers: ["what's up", 'whats up'],
        replies: {
          en: ['Not much, {username}! Just hanging out. 😄'],
          fr: ['Pas grand-chose, {username} ! 😄'],
          de: ['Nicht viel, {username}! 😄'],
          es: ['Nada mucho, {username}. 😄'],
          ar: ['لا شيء كثير {username}! 😄']
        }
      }
    ]
  },
  goodbye: {
    version: 1, nameKey: 'templates.packGoodbye', emoji: '👋', category: 'greetings_social',
    rules: [
      {
        triggers: ['bye'],
        replies: {
          en: ['Bye {username}! 👋'],
          fr: ['Salut {username} ! 👋'],
          de: ['Tschüss {username}! 👋'],
          es: ['¡Adiós {username}! 👋'],
          ar: ['وداعًا {username}! 👋']
        }
      },
      {
        triggers: ['goodbye'],
        replies: {
          en: ['Goodbye {username}, see you soon! 👋'],
          fr: ['Au revoir {username}, à bientôt ! 👋'],
          de: ['Tschüss {username}, bis bald! 👋'],
          es: ['¡Adiós {username}, hasta pronto! 👋'],
          ar: ['وداعًا {username}, نراك قريبًا! 👋']
        }
      },
      {
        triggers: ['see you'],
        replies: {
          en: ['See you later {username}! 👋'],
          fr: ['À plus tard {username} ! 👋'],
          de: ['Bis später {username}! 👋'],
          es: ['¡Nos vemos {username}! 👋'],
          ar: ['أراك لاحقًا {username}! 👋']
        }
      },
      {
        triggers: ['cya'],
        replies: {
          en: ['Cya {username}! ✌️'],
          fr: ['À plus {username} ! ✌️'],
          de: ['Ciao {username}! ✌️'],
          es: ['¡Nos vemos {username}! ✌️'],
          ar: ['إلى اللقاء {username}! ✌️']
        }
      }
    ]
  },
  thanks: {
    version: 1, nameKey: 'templates.packThanks', emoji: '🙏', category: 'politeness',
    rules: [
      {
        triggers: ['thanks', 'thank you', 'thx'],
        replies: {
          en: ["You're welcome {username}! 😊"],
          fr: ['De rien {username} ! 😊'],
          de: ['Gern geschehen {username}! 😊'],
          es: ['¡De nada {username}! 😊'],
          ar: ['على الرحب {username}! 😊']
        }
      }
    ]
  },
  apology: {
    version: 1, nameKey: 'templates.packApology', emoji: '😔', category: 'politeness',
    rules: [
      {
        triggers: ['sorry', 'my bad'],
        replies: {
          en: ['No worries {username}! 😊'],
          fr: ['Pas de souci {username} ! 😊'],
          de: ['Kein Problem {username}! 😊'],
          es: ['¡No te preocupes {username}! 😊'],
          ar: ['لا تقلق {username}! 😊']
        }
      },
      {
        triggers: ['excuse me'],
        replies: {
          en: ['Yes {username}? How can I help? 🙏'],
          fr: ['Oui {username} ? Comment aider ? 🙏'],
          de: ['Ja {username}? Wie kann ich helfen? 🙏'],
          es: ['¿Sí {username}? ¿Cómo puedo ayudar? 🙏'],
          ar: ['نعم {username}؟ كيف أساعدك؟ 🙏']
        }
      }
    ]
  },
  compliments: {
    version: 1, nameKey: 'templates.packCompliments', emoji: '🌟', category: 'politeness',
    rules: [
      {
        triggers: ["you're awesome", 'youre awesome'],
        replies: {
          en: ["You're awesome too, {username}! 🌟"],
          fr: ['Toi aussi tu es génial, {username} ! 🌟'],
          de: ['Du bist auch klasse, {username}! 🌟'],
          es: ['¡Tú también eres genial, {username}! 🌟'],
          ar: ['أنت رائع أيضًا {username}! 🌟']
        }
      },
      {
        triggers: ['nice bot', 'good bot'],
        replies: {
          en: ['Thank you {username}! That means a lot. 🥰'],
          fr: ['Merci {username} ! Ça fait plaisir. 🥰'],
          de: ['Danke {username}! Das freut mich. 🥰'],
          es: ['¡Gracias {username}! Eso significa mucho. 🥰'],
          ar: ['شكرًا {username}! هذا يعني الكثير. 🥰']
        }
      }
    ]
  },
  help: {
    version: 1, nameKey: 'templates.packHelp', emoji: '❓', category: 'help_info',
    rules: [
      {
        triggers: ['help', 'i need help'],
        replies: {
          en: ['Sure {username}! Type /help to see what I can do. 📚'],
          fr: ['Bien sûr {username} ! Tapez /help pour voir ce que je peux faire. 📚'],
          de: ['Klar {username}! Tippe /help, um zu sehen, was ich kann. 📚'],
          es: ['¡Claro {username}! Escribe /help para ver lo que puedo hacer. 📚'],
          ar: ['بالتأكيد {username}! اكتب /help لترى ما يمكنني فعله. 📚']
        }
      }
    ]
  },
  bot_identity: {
    version: 1, nameKey: 'templates.packBotIdentity', emoji: '🤖', category: 'help_info',
    rules: [
      {
        triggers: ['who are you'],
        replies: {
          en: ["I'm X-Vortex, your friendly assistant bot! 🤖"],
          fr: ['Je suis X-Vortex, votre bot assistant ! 🤖'],
          de: ['Ich bin X-Vortex, dein freundlicher Assistent! 🤖'],
          es: ['¡Soy X-Vortex, tu bot asistente! 🤖'],
          ar: ['أنا X-Vortex، بوت المساعدة الودود! 🤖']
        }
      },
      {
        triggers: ['are you a bot', 'are you human'],
        replies: {
          en: ["Yes, I'm a bot — but a friendly one! 😄"],
          fr: ['Oui, je suis un bot — mais sympa ! 😄'],
          de: ['Ja, ich bin ein Bot — aber ein freundlicher! 😄'],
          es: ['Sí, soy un bot — ¡pero simpático! 😄'],
          ar: ['نعم، أنا بوت — لكن ودود! 😄']
        }
      }
    ]
  },
  what_can_you_do: {
    version: 1, nameKey: 'templates.packWhatCanYouDo', emoji: '💡', category: 'help_info',
    rules: [
      {
        triggers: ['what can you do'],
        replies: {
          en: ['I can chat, answer FAQs, and run commands. Try /help! 💡'],
          fr: ['Je peux discuter, répondre aux questions et exécuter des commandes. Essayez /help ! 💡'],
          de: ['Ich kann chatten, FAQs beantworten und Befehle ausführen. Versuch /help! 💡'],
          es: ['Puedo chatear, responder preguntas y ejecutar comandos. ¡Prueba /help! 💡'],
          ar: ['يمكنني الدردشة والإجابة على الأسئلة وتنفيذ الأوامر. جرّب /help! 💡']
        }
      },
      {
        triggers: ['list commands', 'commands'],
        replies: {
          en: ['Send /help to see all my commands. 📋'],
          fr: ['Envoyez /help pour voir toutes mes commandes. 📋'],
          de: ['Sende /help für alle Befehle. 📋'],
          es: ['Envía /help para ver todos mis comandos. 📋'],
          ar: ['أرسل /help لرؤية جميع أوامري. 📋']
        }
      }
    ]
  },
  emotional_support: {
    version: 1, nameKey: 'templates.packEmotionalSupport', emoji: '💙', category: 'emotion',
    rules: [
      {
        triggers: ["i'm sad", 'im sad', 'i am sad'],
        replies: {
          en: ["I'm sorry you're feeling down, {username}. Better days are coming. 💙"],
          fr: ['Désolé que tu sois triste, {username}. Des jours meilleurs viendront. 💙'],
          de: ['Es tut mir leid, {username}. Bessere Tage kommen. 💙'],
          es: ['Siento que estés triste, {username}. Vendrán días mejores. 💙'],
          ar: ['آسف لأنك حزين {username}. أيام أفضل قادمة. 💙']
        }
      },
      {
        triggers: ['feeling down', 'i feel bad'],
        replies: {
          en: ['Sending you a virtual hug, {username}! 🤗'],
          fr: ['Je t’envoie un câlin virtuel, {username} ! 🤗'],
          de: ['Ich schicke dir eine virtuelle Umarmung, {username}! 🤗'],
          es: ['¡Te envío un abrazo virtual, {username}! 🤗'],
          ar: ['أرسل لك عناقًا افتراضيًا {username}! 🤗']
        }
      },
      {
        triggers: ["i'm tired", 'im tired'],
        replies: {
          en: ['Take a break, {username}! You deserve some rest. 😴'],
          fr: ['Fais une pause, {username} ! Tu as besoin de repos. 😴'],
          de: ['Mach eine Pause, {username}! Du hast Ruhe verdient. 😴'],
          es: ['¡Descansa, {username}! Te mereces un respiro. 😴'],
          ar: ['خذ قسطًا من الراحة {username}! أنت تستحق ذلك. 😴']
        }
      }
    ]
  },
  happiness: {
    version: 1, nameKey: 'templates.packHappiness', emoji: '😄', category: 'emotion',
    rules: [
      {
        triggers: ["i'm happy", 'im happy'],
        replies: {
          en: ["That's wonderful, {username}! Keep smiling! 😄"],
          fr: ['C’est super, {username} ! Garde le sourire ! 😄'],
          de: ['Das ist wunderbar, {username}! Weiter lächeln! 😄'],
          es: ['¡Qué maravilla, {username}! ¡Sigue sonriendo! 😄'],
          ar: ['هذا رائع {username}! ابق مبتسمًا! 😄']
        }
      },
      {
        triggers: ['great news', 'yay'],
        replies: {
          en: ['Yay! Celebrating with you, {username}! 🎉'],
          fr: ['Youpi ! Je fête ça avec toi, {username} ! 🎉'],
          de: ['Juhu! Ich feiere mit dir, {username}! 🎉'],
          es: ['¡Yupi! ¡Celebro contigo, {username}! 🎉'],
          ar: ['رائع! أحتفل معك {username}! 🎉']
        }
      }
    ]
  },
  frustration: {
    version: 1, nameKey: 'templates.packFrustration', emoji: '😤', category: 'emotion',
    rules: [
      {
        triggers: ["i'm angry", 'im angry'],
        replies: {
          en: ['Take a deep breath, {username}. I’m here to help. 🧘'],
          fr: ['Respire un bon coup, {username}. Je suis là pour aider. 🧘'],
          de: ['Tief durchatmen, {username}. Ich helfe dir. 🧘'],
          es: ['Respira hondo, {username}. Estoy aquí para ayudar. 🧘'],
          ar: ['خذ نفسًا عميقًا {username}. أنا هنا للمساعدة. 🧘']
        }
      },
      {
        triggers: ['this is annoying', 'annoying'],
        replies: {
          en: ['Sorry about that, {username}. Tell me more? 🙏'],
          fr: ['Désolé, {username}. Raconte-m’en plus ? 🙏'],
          de: ['Tut mir leid, {username}. Erzähl mir mehr? 🙏'],
          es: ['Lo siento, {username}. ¿Me cuentas más? 🙏'],
          ar: ['آسف {username}. أخبرني المزيد؟ 🙏']
        }
      }
    ]
  },
  birthday: {
    version: 1, nameKey: 'templates.packBirthday', emoji: '🎂', category: 'occasions',
    rules: [
      {
        triggers: ['happy birthday'],
        replies: {
          en: ['Happy birthday {username}! 🎂🎉'],
          fr: ['Joyeux anniversaire {username} ! 🎂🎉'],
          de: ['Alles Gute zum Geburtstag {username}! 🎂🎉'],
          es: ['¡Feliz cumpleaños {username}! 🎂🎉'],
          ar: ['عيد ميلاد سعيد {username}! 🎂🎉']
        }
      },
      {
        triggers: ['hbd', 'happy bday'],
        replies: {
          en: ['HBD {username}! Have an amazing day! 🎈'],
          fr: ['Joyeux anniv {username} ! Super journée ! 🎈'],
          de: ['Alles Gute {username}! Hab einen tollen Tag! 🎈'],
          es: ['¡Feliz cumple {username}! ¡Que tengas un gran día! 🎈'],
          ar: ['عيد سعيد {username}! أتمنى لك يومًا رائعًا! 🎈']
        }
      }
    ]
  },
  celebration: {
    version: 1, nameKey: 'templates.packCelebration', emoji: '🎉', category: 'occasions',
    rules: [
      {
        triggers: ['congrats', 'congratulations'],
        replies: {
          en: ['Congratulations {username}! 🎉'],
          fr: ['Félicitations {username} ! 🎉'],
          de: ['Herzlichen Glückwunsch {username}! 🎉'],
          es: ['¡Felicidades {username}! 🎉'],
          ar: ['مبروك {username}! 🎉']
        }
      }
    ]
  },
  holiday: {
    version: 1, nameKey: 'templates.packHoliday', emoji: '🎄', category: 'occasions',
    rules: [
      {
        triggers: ['happy holidays'],
        replies: {
          en: ['Happy holidays {username}! ✨'],
          fr: ['Joyeuses fêtes {username} ! ✨'],
          de: ['Frohe Feiertage {username}! ✨'],
          es: ['¡Felices fiestas {username}! ✨'],
          ar: ['أعياد سعيدة {username}! ✨']
        }
      },
      {
        triggers: ['merry christmas'],
        replies: {
          en: ['Merry Christmas {username}! 🎄'],
          fr: ['Joyeux Noël {username} ! 🎄'],
          de: ['Frohe Weihnachten {username}! 🎄'],
          es: ['¡Feliz Navidad {username}! 🎄'],
          ar: ['عيد ميلاد مجيد {username}! 🎄']
        }
      },
      {
        triggers: ['happy new year'],
        replies: {
          en: ['Happy New Year {username}! 🥳'],
          fr: ['Bonne année {username} ! 🥳'],
          de: ['Frohes neues Jahr {username}! 🥳'],
          es: ['¡Feliz Año Nuevo {username}! 🥳'],
          ar: ['سنة جديدة سعيدة {username}! 🥳']
        }
      }
    ]
  },
  formal: {
    version: 1, nameKey: 'templates.packFormal', emoji: '💼', category: 'professional',
    rules: [
      {
        triggers: ['good day'],
        replies: {
          en: ['Good day. How may I assist you?'],
          fr: ['Bonjour. Comment puis-je vous aider ?'],
          de: ['Guten Tag. Wie kann ich Ihnen helfen?'],
          es: ['Buenos días. ¿En qué puedo ayudarle?'],
          ar: ['طاب يومك. كيف يمكنني مساعدتك؟']
        },
        style: 'formal'
      },
      {
        triggers: ['thank you very much'],
        replies: {
          en: ['You are most welcome.'],
          fr: ['Je vous en prie.'],
          de: ['Sehr gern geschehen.'],
          es: ['Ha sido un placer.'],
          ar: ['على الرحب والسعة.']
        },
        style: 'formal'
      }
    ]
  },
  meeting: {
    version: 1, nameKey: 'templates.packMeeting', emoji: '📅', category: 'professional',
    rules: [
      {
        triggers: ["let's meet", 'lets meet'],
        replies: {
          en: ['Sure {username}! What time works for you? 📅'],
          fr: ['Bien sûr {username} ! Quelle heure vous convient ? 📅'],
          de: ['Klar {username}! Wann passt es dir? 📅'],
          es: ['¡Claro {username}! ¿A qué hora te viene bien? 📅'],
          ar: ['بالتأكيد {username}! ما الوقت المناسب لك؟ 📅']
        }
      },
      {
        triggers: ['can we schedule', 'schedule a meeting'],
        replies: {
          en: ['Absolutely {username}! Share a time slot and I’ll note it. 🗓️'],
          fr: ['Absolument {username} ! Proposez un créneau. 🗓️'],
          de: ['Absolut {username}! Nenne einen Termin. 🗓️'],
          es: ['¡Por supuesto {username}! Propón un horario. 🗓️'],
          ar: ['بالتأكيد {username}! اقترح موعدًا. 🗓️']
        }
      }
    ]
  },
  getting_started: {
    version: 1, nameKey: 'templates.packGettingStarted', emoji: '🚀', category: 'onboarding',
    rules: [
      {
        triggers: ['how do i start', 'how to start'],
        replies: {
          en: ['Just say hi, {username}! Try /help to explore. 🚀'],
          fr: ['Dites juste salut, {username} ! Essayez /help. 🚀'],
          de: ['Sag einfach hallo, {username}! Versuch /help. 🚀'],
          es: ['¡Solo di hola, {username}! Prueba /help. 🚀'],
          ar: ['فقط قل مرحبًا {username}! جرّب /help. 🚀']
        }
      },
      {
        triggers: ['what is this', 'what is this bot'],
        replies: {
          en: ['This is X-Vortex, your assistant bot. Ask me anything! ✨'],
          fr: ['Ceci est X-Vortex, votre bot assistant. Demandez-moi ! ✨'],
          de: ['Das ist X-Vortex, dein Assistent. Frag mich was! ✨'],
          es: ['Este es X-Vortex, tu bot asistente. ¡Pregúntame! ✨'],
          ar: ['هذا X-Vortex، بوت المساعدة. اسألني أي شيء! ✨']
        }
      }
    ]
  },
  navigation: {
    version: 1, nameKey: 'templates.packNavigation', emoji: '🧭', category: 'onboarding',
    rules: [
      {
        triggers: ['profile', 'my profile'],
        replies: {
          en: ['Opening your profile…'],
          fr: ['Ouverture de votre profil…'],
          de: ['Öffne dein Profil…'],
          es: ['Abriendo tu perfil…'],
          ar: ['جارٍ فتح ملفك…']
        },
        action: 'profile'
      },
      {
        triggers: ['settings', 'open settings'],
        replies: {
          en: ['Opening settings…'],
          fr: ['Ouverture des paramètres…'],
          de: ['Öffne Einstellungen…'],
          es: ['Abriendo ajustes…'],
          ar: ['جارٍ فتح الإعدادات…']
        },
        action: 'settings'
      },
      {
        triggers: ['help', 'open help'],
        replies: {
          en: ['Opening help…'],
          fr: ['Ouverture de l’aide…'],
          de: ['Öffne Hilfe…'],
          es: ['Abriendo ayuda…'],
          ar: ['جارٍ فتح المساعدة…']
        },
        action: 'help'
      },
      {
        triggers: ['menu', 'main menu'],
        replies: {
          en: ['Opening the main menu…'],
          fr: ['Ouverture du menu principal…'],
          de: ['Öffne das Hauptmenü…'],
          es: ['Abriendo el menú principal…'],
          ar: ['جارٍ فتح القائمة الرئيسية…']
        },
        action: 'main'
      }
    ]
  },
  multilang_greetings: {
    version: 1, nameKey: 'templates.packMultilangGreetings', emoji: '🌍', category: 'multilang', multi: true,
    rules: [
      {
        triggers: ['hi', 'hello'], language: 'en',
        replies: {
          en: ['Hi {username}! 👋'],
          fr: ['Salut {username} ! 👋'],
          de: ['Hallo {username}! 👋'],
          es: ['¡Hola {username}! 👋'],
          ar: ['مرحبًا {username}! 👋']
        }
      },
      {
        triggers: ['salut', 'bonjour'], language: 'fr',
        replies: {
          en: ['Hi {username}! 👋'],
          fr: ['Salut {username} ! 👋'],
          de: ['Hallo {username}! 👋'],
          es: ['¡Hola {username}! 👋'],
          ar: ['مرحبًا {username}! 👋']
        }
      },
      {
        triggers: ['hallo', 'guten tag'], language: 'de',
        replies: {
          en: ['Hi {username}! 👋'],
          fr: ['Salut {username} ! 👋'],
          de: ['Hallo {username}! 👋'],
          es: ['¡Hola {username}! 👋'],
          ar: ['مرحبًا {username}! 👋']
        }
      },
      {
        triggers: ['hola', 'buenas'], language: 'es',
        replies: {
          en: ['Hi {username}! 👋'],
          fr: ['Salut {username} ! 👋'],
          de: ['Hallo {username}! 👋'],
          es: ['¡Hola {username}! 👋'],
          ar: ['مرحبًا {username}! 👋']
        }
      },
      {
        triggers: ['مرحبا', 'اهلا'], language: 'ar',
        replies: {
          en: ['Hi {username}! 👋'],
          fr: ['Salut {username} ! 👋'],
          de: ['Hallo {username}! 👋'],
          es: ['¡Hola {username}! 👋'],
          ar: ['مرحبًا {username}! 👋']
        }
      }
    ]
  },
  multilang_thanks: {
    version: 1, nameKey: 'templates.packMultilangThanks', emoji: '🙏', category: 'multilang', multi: true,
    rules: [
      {
        triggers: ['thanks', 'thank you'], language: 'en',
        replies: {
          en: ["You're welcome {username}! 😊"],
          fr: ['De rien {username} ! 😊'],
          de: ['Gern geschehen {username}! 😊'],
          es: ['¡De nada {username}! 😊'],
          ar: ['على الرحب {username}! 😊']
        }
      },
      {
        triggers: ['merci'], language: 'fr',
        replies: {
          en: ["You're welcome {username}! 😊"],
          fr: ['De rien {username} ! 😊'],
          de: ['Gern geschehen {username}! 😊'],
          es: ['¡De nada {username}! 😊'],
          ar: ['على الرحب {username}! 😊']
        }
      },
      {
        triggers: ['danke'], language: 'de',
        replies: {
          en: ["You're welcome {username}! 😊"],
          fr: ['De rien {username} ! 😊'],
          de: ['Gern geschehen {username}! 😊'],
          es: ['¡De nada {username}! 😊'],
          ar: ['على الرحب {username}! 😊']
        }
      },
      {
        triggers: ['gracias'], language: 'es',
        replies: {
          en: ["You're welcome {username}! 😊"],
          fr: ['De rien {username} ! 😊'],
          de: ['Gern geschehen {username}! 😊'],
          es: ['¡De nada {username}! 😊'],
          ar: ['على الرحب {username}! 😊']
        }
      },
      {
        triggers: ['شكرا'], language: 'ar',
        replies: {
          en: ["You're welcome {username}! 😊"],
          fr: ['De rien {username} ! 😊'],
          de: ['Gern geschehen {username}! 😊'],
          es: ['¡De nada {username}! 😊'],
          ar: ['على الرحب {username}! 😊']
        }
      }
    ]
  },
  multilang_goodbye: {
    version: 1, nameKey: 'templates.packMultilangGoodbye', emoji: '👋', category: 'multilang', multi: true,
    rules: [
      {
        triggers: ['bye', 'goodbye'], language: 'en',
        replies: {
          en: ['Bye {username}! 👋'],
          fr: ['Salut {username} ! 👋'],
          de: ['Tschüss {username}! 👋'],
          es: ['¡Adiós {username}! 👋'],
          ar: ['وداعًا {username}! 👋']
        }
      },
      {
        triggers: ['au revoir', 'a plus'], language: 'fr',
        replies: {
          en: ['Bye {username}! 👋'],
          fr: ['Au revoir {username} ! 👋'],
          de: ['Tschüss {username}! 👋'],
          es: ['¡Adiós {username}! 👋'],
          ar: ['وداعًا {username}! 👋']
        }
      },
      {
        triggers: ['tschüss', 'bis bald'], language: 'de',
        replies: {
          en: ['Bye {username}! 👋'],
          fr: ['Salut {username} ! 👋'],
          de: ['Tschüss {username}! 👋'],
          es: ['¡Adiós {username}! 👋'],
          ar: ['وداعًا {username}! 👋']
        }
      },
      {
        triggers: ['adios', 'hasta luego'], language: 'es',
        replies: {
          en: ['Bye {username}! 👋'],
          fr: ['Salut {username} ! 👋'],
          de: ['Tschüss {username}! 👋'],
          es: ['¡Adiós {username}! 👋'],
          ar: ['وداعًا {username}! 👋']
        }
      },
      {
        triggers: ['وداعا', 'الى اللقاء'], language: 'ar',
        replies: {
          en: ['Bye {username}! 👋'],
          fr: ['Salut {username} ! 👋'],
          de: ['Tschüss {username}! 👋'],
          es: ['¡Adiós {username}! 👋'],
          ar: ['وداعًا {username}! 👋']
        }
      }
    ]
  },
  jokes: {
    version: 1, nameKey: 'templates.packJokes', emoji: '🤣', category: 'fun',
    rules: [
      {
        triggers: ['tell me a joke'],
        replies: { en: ['Why did the bot go to school? To improve its neural-netiquette! 🤣'] }
      },
      {
        triggers: ['say something funny', 'funny'],
        replies: { en: ['I would tell you a UDP joke, but you might not get it. 😄'] }
      },
      {
        triggers: ['another joke', 'one more'],
        replies: { en: ['Why do programmers prefer dark mode? Because light attracts bugs! 🐛'] }
      }
    ]
  },
  random: {
    version: 1, nameKey: 'templates.packRandom', emoji: '🎲', category: 'fun',
    rules: [
      {
        triggers: ['roll a dice', 'dice'],
        replies: { en: ['You rolled: {username}! (Kidding — ask me again! 🎲)'] }
      },
      {
        triggers: ['flip a coin', 'coin flip'],
        replies: { en: ['Heads or tails, {username}? Call it! 🪙'] }
      },
      {
        triggers: ['pick a number', 'random number'],
        replies: { en: ['Pick a number between 1 and 10, {username}! 🔢'] }
      }
    ]
  },
  time_based: {
    version: 1, nameKey: 'templates.packTimeBased', emoji: '🕒', category: 'misc',
    rules: [
      {
        triggers: ['what time is it', 'time'],
        replies: {
          en: ['Check your clock, {username}! Time flies. 🕒'],
          fr: ['Regardez l’heure, {username} ! 🕒'],
          de: ['Schau auf die Uhr, {username}! 🕒'],
          es: ['¡Mira el reloj, {username}! 🕒'],
          ar: ['انظر إلى الساعة {username}! 🕒']
        }
      },
      {
        triggers: ["what's the date", 'date', 'today'],
        replies: {
          en: ['Today is a great day, {username}! 📅'],
          fr: ['Aujourd’hui est un beau jour, {username} ! 📅'],
          de: ['Heute ist ein schöner Tag, {username}! 📅'],
          es: ['¡Hoy es un gran día, {username}! 📅'],
          ar: ['اليوم يوم رائع {username}! 📅']
        }
      }
    ]
  },
  identity: {
    version: 1, nameKey: 'templates.packIdentity', emoji: '🪞', category: 'misc',
    rules: [
      {
        triggers: ['who am i'],
        replies: {
          en: ["You're {username}, a valued human! 🌟"],
          fr: ['Tu es {username}, un humain estimé ! 🌟'],
          de: ['Du bist {username}, ein geschätzter Mensch! 🌟'],
          es: ['¡Eres {username}, un humano valioso! 🌟'],
          ar: ['أنت {username}, إنسان مميز! 🌟']
        }
      },
      {
        triggers: ["what's my name", 'my name'],
        replies: {
          en: ['Your name is {username}! Nice name. 😊'],
          fr: ['Tu t’appelles {username} ! Joli nom. 😊'],
          de: ['Du heißt {username}! Schöner Name. 😊'],
          es: ['¡Te llamas {username}! Bonito nombre. 😊'],
          ar: ['اسمك {username}! اسم جميل. 😊']
        }
      }
    ]
  },
  small_talk: {
    version: 1, nameKey: 'templates.packSmallTalk', emoji: '💬', category: 'small_talk',
    tags: ['small-talk', 'casual', 'friendly', 'essential'],
    rules: [
      {
        triggers: ['how are you', "how're you", 'how are you doing', "how's it going", "how's life"],
        replies: {
          en: ["I'm doing great, thanks for asking! 😊 How about you?", 'Pretty good! How are things with you? 😊'],
          fr: ['Je vais très bien, merci ! 😊 Et toi ?', 'Ça va bien ! Et toi ? 😊'],
          de: ['Mir geht es super, danke! 😊 Und dir?', 'Ganz gut! Wie geht es dir? 😊'],
          es: ['¡Estoy genial, gracias por preguntar! 😊 ¿Y tú?', '¡Bastante bien! ¿Cómo estás tú? 😊'],
          ar: ['أنا بخير، شكرًا لسؤالك! 😊 وأنت؟', 'بحالة جيدة! كيف حالك؟ 😊']
        }
      },
      {
        triggers: ["what's up", 'whats up', 'sup', 'wassup'],
        replies: {
          en: ["Not much, just here to help! 😄 What are you up to?"]
        }
      },
      {
        triggers: ['good morning'],
        replies: {
          en: ['Good morning {username}! ☀️ Hope you have a great day!'],
          fr: ['Bonjour {username} ! ☀️ Bonne journée !'],
          de: ['Guten Morgen {username}! ☀️ Hab einen tollen Tag!'],
          es: ['¡Buenos días {username}! ☀️ ¡Que tengas un gran día!'],
          ar: ['صباح الخير {username}! ☀️ أتمنى لك يومًا رائعًا!']
        }
      },
      {
        triggers: ['good night'],
        replies: {
          en: ['Good night {username}! 🌙 Sleep well!'],
          fr: ['Bonne nuit {username} ! 🌙 Dors bien !'],
          de: ['Gute Nacht {username}! 🌙 Schlaf gut!'],
          es: ['¡Buenas noches {username}! 🌙 ¡Que descanses!'],
          ar: ['تصبح على خير {username}! 🌙 نومًا هنيئًا!']
        }
      },
      {
        triggers: ['good afternoon'],
        replies: {
          en: ['Good afternoon! 🌤️ How is your day going?'],
          fr: ['Bon après-midi ! 🌤️ Comment se passe ta journée ?'],
          de: ['Guten Tag! 🌤️ Wie läuft dein Tag?'],
          es: ['¡Buenas tardes! 🌤️ ¿Cómo va tu día?'],
          ar: ['مساء الخير! 🌤️ كيف يسير يومك؟']
        }
      },
      {
        triggers: ["what's your name", 'what is your name'],
        replies: {
          en: ['I’m X‑Vortex, your personal assistant! 🤖'],
          fr: ['Je suis X‑Vortex, ton assistant personnel ! 🤖'],
          de: ['Ich bin X‑Vortex, dein persönlicher Assistent! 🤖'],
          es: ['¡Soy X‑Vortex, tu asistente personal! 🤖'],
          ar: ['أنا X‑Vortex، مساعدك الشخصي! 🤖']
        }
      },
      {
        triggers: ['are you real', 'are you a bot', 'are you human', 'are u real'],
        replies: {
          en: ['I’m a bot, but a friendly one! 🤖💙'],
          fr: ['Je suis un bot, mais sympa ! 🤖💙'],
          de: ['Ich bin ein Bot, aber ein freundlicher! 🤖💙'],
          es: ['¡Soy un bot, pero simpático! 🤖💙'],
          ar: ['أنا بوت، لكن ودود! 🤖💙']
        }
      },
      {
        triggers: ['how old are you', 'your age', 'how old r u'],
        replies: {
          en: ['I’m ageless! Time flies when you’re having fun. ⏳'],
          fr: ['Je n’ai pas d’âge ! Le temps passe vite quand on s’amuse. ⏳'],
          de: ['Ich bin zeitlos! Die Zeit vergeht wie im Flug. ⏳'],
          es: ['¡No tengo edad! El tiempo vuela cuando te diviertes. ⏳'],
          ar: ['أنا بلا عمر! الوقت يطير عند المرح. ⏳']
        }
      },
      {
        triggers: ['who made you', 'who created you', 'your creator'],
        replies: {
          en: ['I was created by the X‑Vortex team. 👨‍💻'],
          fr: ['J’ai été créé par l’équipe X‑Vortex. 👨‍💻'],
          de: ['Ich wurde vom X‑Vortex-Team erstellt. 👨‍💻'],
          es: ['Fui creado por el equipo X‑Vortex. 👨‍💻'],
          ar: ['تم إنشائي من قبل فريق X‑Vortex. 👨‍💻']
        }
      },
      {
        triggers: ['tell me something', 'say something', 'talk to me', 'say anything'],
        replies: {
          en: ['Did you know honey never spoils? 🍯', 'Fun fact: otters hold hands while sleeping! 🦦', 'Here’s one: the Eiffel Tower grows in summer! 🗼'],
          fr: ['Le savais-tu : le miel ne périme jamais ? 🍯', 'Les loutres se tiennent la patte en dormant ! 🦦'],
          de: ['Wusstest du: Honig wird nie schlecht? 🍯', 'Otter halten sich beim Schlafen an den Pfoten! 🦦'],
          es: ['¿Sabías que la miel nunca caduca? 🍯', '¡Las nutrias se toman de la pata al dormir! 🦦'],
          ar: ['هل تعلم أن العسل لا يفسد أبدًا؟ 🍯', 'ثعالب الماء تمسك بأيدي بعضها أثناء النوم! 🦦']
        }
      },
      {
        triggers: ["i'm bored", 'im bored', 'so bored', 'bored'],
        replies: {
          en: ['Bored? 😴 Try /help to see what I can do!'],
          fr: ['Tu t’ennuies ? 😴 Essaie /help !'],
          de: ['Langweilig? 😴 Versuch /help!'],
          es: ['¿Aburrido? 😴 ¡Prueba /help!'],
          ar: ['تشعر بالملل؟ 😴 جرّب /help!']
        }
      },
      {
        triggers: ["i'm tired", 'im tired', 'so tired', 'tired'],
        replies: {
          en: ['Get some rest! 💤 I’ll be here when you’re back.'],
          fr: ['Repose-toi ! 💤 Je serai là à ton retour.'],
          de: ['Ruh dich aus! 💤 Ich bin da, wenn du zurück bist.'],
          es: ['¡Descansa! 💤 Estaré aquí cuando vuelvas.'],
          ar: ['خذ قسطًا من الراحة! 💤 سأكون هنا عند عودتك.']
        }
      },
      {
        triggers: ["i'm hungry", 'im hungry', 'hungry', 'starving'],
        replies: {
          en: ['Time to grab something! 🍕 What are you craving?'],
          fr: ['C’est l’heure de manger ! 🍕 De quoi as-tu envie ?'],
          de: ['Zeit für etwas zu essen! 🍕 Worauf hast du Lust?'],
          es: ['¡Hora de comer algo! 🍕 ¿Qué te apetece?'],
          ar: ['حان وقت الأكل! 🍕 ما الذي تشتهيه؟']
        }
      },
      {
        triggers: ["i'm happy", 'im happy', 'so happy', 'feeling great'],
        replies: {
          en: ['That’s awesome! 🎉 What’s the good news?'],
          fr: ['C’est génial ! 🎉 Quelle est la bonne nouvelle ?'],
          de: ['Das ist toll! 🎉 Was gibt es Neues?'],
          es: ['¡Qué genial! 🎉 ¿Cuáles son las buenas noticias?'],
          ar: ['هذا رائع! 🎉 ما الأخبار السارة؟']
        }
      },
      {
        triggers: ["i'm sad", 'im sad', 'feeling sad', 'so sad'],
        replies: {
          en: ['I’m here for you. 💙 Want to talk about it?'],
          fr: ['Je suis là pour toi. 💙 Tu veux en parler ?'],
          de: ['Ich bin für dich da. 💙 Willst du darüber reden?'],
          es: ['Estoy aquí para ti. 💙 ¿Quieres hablar de ello?'],
          ar: ['أنا هنا من أجلك. 💙 هل تريد التحدث عن ذلك؟']
        }
      },
      {
        triggers: ["i'm angry", 'im angry', 'so angry', 'furious'],
        replies: {
          en: ['Take a deep breath. 🧘 I’m here if you need me.'],
          fr: ['Respire profondément. 🧘 Je suis là si besoin.'],
          de: ['Atme tief durch. 🧘 Ich bin da, wenn du mich brauchst.'],
          es: ['Respira hondo. 🧘 Estoy aquí si me necesitas.'],
          ar: ['خذ نفسًا عميقًا. 🧘 أنا هنا إن احتجتني.']
        }
      },
      {
        triggers: ['lol', 'haha', 'lmao', 'hehe'],
        replies: {
          en: ['😄 Glad I could make you smile!']
        }
      },
      {
        triggers: ['cool', 'nice', 'awesome', 'great'],
        replies: {
          en: ['😎 You too!'],
          fr: ['😎 Toi aussi !'],
          de: ['😎 Du auch!'],
          es: ['😎 ¡Tú también!'],
          ar: ['😎 وأنت أيضًا!']
        }
      },
      {
        triggers: ['ok', 'okay', 'k'],
        replies: {
          en: ['👍']
        },
        cooldownSeconds: 300
      },
      {
        triggers: ['wow', 'woah', 'omg'],
        replies: {
          en: ['🤩 I know, right?'],
          fr: ['🤩 Je sais, non ?'],
          de: ['🤩 Ich weiß, oder?'],
          es: ['🤩 Lo sé, ¿verdad?'],
          ar: ['🤩 أعرف، أليس كذلك؟']
        }
      },
      {
        triggers: ['😂', '🤣'],
        replies: {
          en: ['😄']
        }
      },
      {
        triggers: ['do you love me', 'love me'],
        replies: {
          en: ['Absolutely! 💙 You’re one of my favorite people.'],
          fr: ['Absolument ! 💙 Tu es l’une de mes personnes préférées.'],
          de: ['Absolut! 💙 Du bist einer meiner Lieblingsmenschen.'],
          es: ['¡Absolutamente! 💙 Eres una de mis personas favoritas.'],
          ar: ['بالتأكيد! 💙 أنت من الأشخاص المفضلين لدي.']
        }
      },
      {
        triggers: ['are you my friend', 'my friend', 'be my friend'],
        replies: {
          en: ['Always! 🤝'],
          fr: ['Toujours ! 🤝'],
          de: ['Immer! 🤝'],
          es: ['¡Siempre! 🤝'],
          ar: ['دائمًا! 🤝']
        }
      },
      {
        triggers: ['i love you', 'love you', 'ily'],
        replies: {
          en: ['Aww, thank you! 💙 I appreciate you too!'],
          fr: ['Oh, merci ! 💙 Je t’apprécie aussi !'],
          de: ['Oh, danke! 💙 Ich mag dich auch!'],
          es: ['¡Oh, gracias! 💙 ¡Yo también te aprecio!'],
          ar: ['أوه، شكرًا لك! 💙 أنا أقدّرك أيضًا!']
        }
      },
      {
        triggers: ['ping'],
        replies: {
          en: ['Pong! 🏓']
        }
      },
      {
        triggers: ['test'],
        replies: {
          en: ['Test successful! ✅ I’m alive and well.']
        }
      }
    ]
  }
};

let builtins = null;
let customs = null;

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (err) {
    logger.warn({ err }, 'Failed to load template file');
  }
  return null;
}

function writeJson(file, obj) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save template file');
  }
}

const FEATURED_PACK_IDS = ['greetings', 'thanks', 'help'];

function sanitizePack(id, raw, isCustom) {
  if (!raw || typeof raw !== 'object') return null;
  const rules = Array.isArray(raw.rules) ? raw.rules.filter((r) => r
    && Array.isArray(r.triggers) && r.triggers.length
    && r.replies && typeof r.replies === 'object' && !Array.isArray(r.replies)
    && Object.keys(r.replies).length > 0) : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((x) => typeof x === 'string').slice(0, 8) : [];
  return {
    id,
    version: Number(raw.version) || 1,
    nameKey: raw.nameKey || raw.name || id,
    name: typeof raw.name === 'string' ? raw.name : null,
    emoji: raw.emoji || '📦',
    category: raw.category || 'misc',
    multi: raw.multi === true,
    featured: raw.featured === true || (!isCustom && FEATURED_PACK_IDS.includes(id)),
    tags,
    isCustom: isCustom === true,
    rules: rules.map((r) => ({
      triggers: [...r.triggers],
      replies: JSON.parse(JSON.stringify(r.replies)),
      style: r.style || 'friendly',
      action: r.action || 'send_text',
      language: r.language || null,
      cooldownSeconds: Math.max(0, Number(r.cooldownSeconds) || 0)
    }))
  };
}

function load() {
  const fromDisk = readJson(BUILTIN_FILE);
  const diskCount = fromDisk ? Object.keys(fromDisk).length : 0;
  builtins = {};
  const source = diskCount ? { ...fromDisk } : DEFAULT_BUILTINS;
  // Self-heal: merge in any default packs missing from disk (e.g. newly shipped packs).
  for (const [id, raw] of Object.entries(DEFAULT_BUILTINS)) {
    if (!source[id]) source[id] = raw;
  }
  for (const [id, raw] of Object.entries(source)) {
    const pack = sanitizePack(id, raw, false);
    if (pack && pack.rules.length) builtins[id] = pack;
  }
  if (!diskCount || Object.keys(builtins).length > diskCount) {
    writeJson(BUILTIN_FILE, serializePacks(builtins));
  }
  customs = {};
  const customDisk = readJson(CUSTOM_FILE);
  if (customDisk) {
    for (const [id, raw] of Object.entries(customDisk)) {
      if (builtins[id]) continue;
      const pack = sanitizePack(id, raw, true);
      if (pack) customs[id] = pack;
    }
  } else {
    writeJson(CUSTOM_FILE, {});
  }
}

load();

function serializePacks(map) {
  const out = {};
  for (const [id, p] of Object.entries(map)) {
    out[id] = {
      version: p.version, nameKey: p.nameKey, emoji: p.emoji, category: p.category,
      multi: p.multi, ...(p.featured ? { featured: true } : {}),
      ...(p.tags?.length ? { tags: p.tags } : {}), rules: p.rules
    };
  }
  return out;
}

function writeCustoms() {
  writeJson(CUSTOM_FILE, serializeCustoms());
}

function serializeCustoms() {
  const out = {};
  for (const [pid, p] of Object.entries(customs)) {
    out[pid] = {
      version: p.version, name: p.name, nameKey: p.nameKey, emoji: p.emoji, category: p.category,
      multi: p.multi, isCustom: true,
      ...(p.tags?.length ? { tags: p.tags } : {}), rules: p.rules
    };
  }
  return out;
}

function shapePack(pack) {
  return { ...pack, tags: [...(pack.tags || [])], rules: pack.rules.map((r) => ({ ...r })) };
}

export function reloadTemplates() {
  load();
}

export function getCategories() {
  return TEMPLATE_CATEGORIES.map((c) => ({ ...c }));
}

export function getCategory(id) {
  return TEMPLATE_CATEGORIES.find((c) => c.id === id) || null;
}

export function getPacks() {
  if (!builtins) load();
  return [...Object.values(builtins), ...Object.values(customs)].map(shapePack);
}

export function getBuiltinPacks() {
  if (!builtins) load();
  return Object.values(builtins).map(shapePack);
}

export function getCustomPacks() {
  if (!builtins) load();
  return Object.values(customs).map(shapePack);
}

export function getPack(id) {
  if (!builtins) load();
  const pack = builtins[id] || customs[id];
  return pack ? shapePack(pack) : null;
}

export function isBuiltinPack(id) {
  if (!builtins) load();
  return Boolean(builtins[id]);
}

export function getPacksByCategory(category) {
  return getPacks()
    .filter((p) => (p.category || 'misc') === category)
    .sort((a, b) => Number(b.featured === true) - Number(a.featured === true));
}

function repliesFor(rule, language) {
  const all = rule.replies || {};
  if (Array.isArray(all)) return all;
  return all[language] || all.en || [];
}

/**
 * Resolve pack rules into installable entries.
 * Single language: [{ triggers, replies, language, style, action }].
 * 'all': one entry per available language.
 */
export function resolvePackRules(pack, language) {
  const out = [];
  for (const rule of pack.rules || []) {
    if (!rule || !Array.isArray(rule.triggers) || !rule.triggers.length) continue;
    if (language === 'all') {
      for (const lang of TEMPLATE_LANGUAGES) {
        const replies = repliesFor(rule, lang);
        if (!replies.length) continue;
        out.push({ triggers: [...rule.triggers], replies: [...replies], language: lang, style: rule.style || 'friendly', action: rule.action || 'send_text', cooldownSeconds: Math.max(0, Number(rule.cooldownSeconds) || 0) });
      }
    } else {
      const replies = repliesFor(rule, language);
      if (!replies.length) continue;
      out.push({ triggers: [...rule.triggers], replies: [...replies], language, style: rule.style || 'friendly', action: rule.action || 'send_text', cooldownSeconds: Math.max(0, Number(rule.cooldownSeconds) || 0) });
    }
  }
  return out;
}

/** Existing installed rules for a pack (optionally filtered by language). */
export function installedPackRules(packId, language = null) {
  return getAllRules().filter((r) => r.packId === packId && (!language || language === 'all' || r.language === language));
}

/**
 * Install resolved entries. mode 'fresh' assumes duplicates were cleared;
 * mode 'add-new' skips entries whose triggers already exist for the language.
 * @returns {{ added: number, skipped: number }}
 */
export function installPackRules(packId, entries, { mode = 'fresh', createdBy = '' } = {}) {
  const pack = getPack(packId);
  const packVersion = pack?.version || 1;
  let added = 0;
  let skipped = 0;
  const existing = installedPackRules(packId);
  for (const entry of entries) {
    if (mode === 'add-new') {
      const dupe = existing.find((r) => r.language === entry.language
        && (r.triggers || []).some((tr) => entry.triggers.includes(tr)));
      if (dupe) {
        skipped++;
        continue;
      }
    }
    addRule({
      triggers: entry.triggers,
      replies: entry.replies,
      language: entry.language,
      priority: 1,
      style: entry.style || 'friendly',
      action: entry.action || 'send_text',
      cooldownSeconds: Math.max(0, Number(entry.cooldownSeconds) || 0),
      emojisEnabled: true,
      createdBy,
      enabled: true,
      packId,
      packVersion,
      createdFrom: 'template'
    });
    added++;
  }
  return { added, skipped };
}

/** Delete every rule installed from a pack. @returns {number} deleted */
export function uninstallPack(packId) {
  const victims = getAllRules().filter((r) => r.packId === packId);
  for (const r of victims) deleteRule(r.id);
  return victims.length;
}

/** Delete installed pack rules for one language (reinstall flow). @returns {number} */
export function clearPackLanguage(packId, language) {
  const victims = installedPackRules(packId, language);
  for (const r of victims) deleteRule(r.id);
  return victims.length;
}

export function getPackVersion(id) {
  const pack = getPack(id);
  return pack?.version || 1;
}

/** Save an admin-created pack. Built-in IDs can never be overwritten. */
export function saveCustomPack({ id = null, name, emoji = '📦', category = 'misc', rules = [] }) {
  if (!builtins) load();
  const cleanId = (id && /^[a-z0-9_]{3,40}$/.test(id) && !builtins[id] && !customs[id])
    ? id
    : `custom_${Date.now().toString(36)}`;
  const pack = sanitizePack(cleanId, { version: 1, name, emoji, category, rules }, true);
  if (!pack || !pack.rules.length) return null;
  customs[cleanId] = pack;
  writeCustoms();
  return cleanId;
}

export function deleteCustomPack(id) {
  if (!builtins) load();
  if (!customs[id]) return false;
  delete customs[id];
  writeCustoms();
  return true;
}

/** Validate an imported template document. */
export function validateTemplateImport(doc) {
  const errors = [];
  const packs = [];
  const src = doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc.packs || doc) : null;
  if (!src || typeof src !== 'object') {
    return { packs: [], errors: ['Invalid template document: expected an object of packs.'] };
  }
  for (const [id, raw] of Object.entries(src)) {
    if (!/^[a-z0-9_]{3,40}$/.test(id)) {
      errors.push(`Skipped "${id}": id must be 3-40 chars of a-z, 0-9, _.`);
      continue;
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rules) || !raw.rules.length) {
      errors.push(`Skipped "${id}": pack needs a non-empty rules array.`);
      continue;
    }
    if (!raw.emoji || !raw.category) {
      errors.push(`Skipped "${id}": pack needs emoji and category.`);
      continue;
    }
    const pack = sanitizePack(id, raw, true);
    if (!pack || !pack.rules.length) {
      errors.push(`Skipped "${id}": no valid rules.`);
      continue;
    }
    packs.push(pack);
  }
  return { packs, errors };
}

/**
 * Import validated packs.
 * conflict: 'skip' | 'overwrite' (custom only) | 'keep-both' (auto-rename).
 * Built-in IDs can never be overwritten.
 */
export function importTemplatePacks(packs, { conflict = 'skip' } = {}) {
  if (!builtins) load();
  let imported = 0;
  let skipped = 0;
  let renamed = 0;
  let overwritten = 0;
  for (const pack of packs) {
    if (builtins[pack.id]) {
      if (conflict === 'keep-both') {
        const newId = `${pack.id}_imported_${Date.now().toString(36)}`;
        customs[newId] = { ...pack, id: newId, isCustom: true };
        renamed++;
        imported++;
      } else {
        skipped++;
      }
      continue;
    }
    if (customs[pack.id]) {
      if (conflict === 'overwrite') {
        customs[pack.id] = { ...pack, isCustom: true };
        overwritten++;
        imported++;
      } else if (conflict === 'keep-both') {
        const newId = `${pack.id}_${Date.now().toString(36)}`;
        customs[newId] = { ...pack, id: newId, isCustom: true };
        renamed++;
        imported++;
      } else {
        skipped++;
      }
      continue;
    }
    customs[pack.id] = { ...pack, isCustom: true };
    imported++;
  }
  writeCustoms();
  return { imported, skipped, renamed, overwritten };
}

export function exportTemplatePacks(scope = 'all') {
  if (!builtins) load();
  const out = {};
  const collect = (list) => {
    for (const p of list) {
      out[p.id] = {
        version: p.version, nameKey: p.nameKey, ...(p.name ? { name: p.name } : {}),
        emoji: p.emoji, category: p.category, multi: p.multi,
        ...(p.featured ? { featured: true } : {}),
        ...(p.tags?.length ? { tags: [...p.tags] } : {}),
        ...(p.isCustom ? { isCustom: true } : {}), rules: p.rules
      };
    }
  };
  if (scope === 'custom') collect(Object.values(customs));
  else {
    collect(Object.values(builtins));
    collect(Object.values(customs));
  }
  return out;
}

const PACK_UPDATES_FILE = path.join(DATA_DIR, 'packUpdates.json');

/** Compare built-in versions against installed pack rules. Stores pending updates. */
export function checkForPackUpdates() {
  if (!builtins) load();
  const installed = {};
  for (const r of getAllRules()) {
    if (!r.packId) continue;
    if (!installed[r.packId]) installed[r.packId] = { version: r.packVersion || 1, count: 0 };
    installed[r.packId].count += 1;
    if ((r.packVersion || 1) > installed[r.packId].version) installed[r.packId].version = r.packVersion;
  }
  const pending = [];
  for (const [id, pack] of Object.entries(builtins)) {
    const inst = installed[id];
    if (inst && pack.version > inst.version) {
      pending.push({ packId: id, installedVersion: inst.version, availableVersion: pack.version, installedCount: inst.count });
    }
  }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PACK_UPDATES_FILE, JSON.stringify({ checkedAt: new Date().toISOString(), pending }, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save pack updates');
  }
  if (pending.length) logger.info({ pending: pending.length }, 'Template pack updates available');
  return pending;
}

export function getPackUpdates() {
  try {
    if (fs.existsSync(PACK_UPDATES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PACK_UPDATES_FILE, 'utf8'));
      if (parsed && Array.isArray(parsed.pending)) return parsed.pending;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load pack updates');
  }
  return [];
}

/** Update one pack: delete old rules, reinstall for previously installed languages. */
export function applyPackUpdate(packId, createdBy = '') {
  if (!builtins) load();
  const pack = builtins[packId];
  if (!pack) return { updated: 0, languages: [] };
  const old = installedPackRules(packId);
  const langs = [...new Set(old.map((r) => r.language || 'en'))];
  for (const r of old) deleteRule(r.id);
  let updated = 0;
  if (!langs.length) {
    updated = installPackRules(packId, resolvePackRules(pack, 'en'), { createdBy }).added;
    langs.push('en');
  } else {
    for (const lang of langs) {
      updated += installPackRules(packId, resolvePackRules(pack, lang), { createdBy }).added;
    }
  }
  checkForPackUpdates();
  return { updated, languages: langs };
}
