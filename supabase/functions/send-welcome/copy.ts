// What the welcome says, in the languages the app speaks.
//
// Kept beside the function rather than in src/locales, because an Edge
// Function cannot import from the app bundle and a copy of 1,187 keys to reach
// six of them would be worse than this.
//
// Where a line already exists in the catalogues, it is copied from there
// rather than translated again. The second paragraph is `landing.about.lead`
// with its opening clause dropped, and `action` is `landing.continue` verbatim.
// Two translations of one sentence drift, and the landing page and the welcome
// are the first two things a person reads -- they should not describe the
// product differently.
//
// That is also what settles the name. Most languages keep "The Digital
// Atrium" whole; Portuguese takes the article into the preposition and says
// "no Digital Atrium". Each language does here what it already does in its own
// catalogue, rather than following a rule invented in this file.
//
// Deliberately short. A first message that asks to be read twice is a first
// message that gets read none.

export interface Welcome {
  subject: string
  heading: string
  greeting: (name: string) => string
  body: string
  action: string
  footnote: string
  footer: string
}

export const WELCOME_COPY = {
  en: {
    subject: 'Welcome to The Digital Atrium',
    heading: 'Welcome',
    greeting: (name: string) => `Hello ${name},`,
    body: 'Welcome to The Digital Atrium!\nA mix of Pinterest, Canva, Figma and PureRef.\n\nA fast, flexible tool, great for brainstorming, working out ideas, diagrams and much more.',
    action: 'Enter The Digital Atrium',
    footnote: 'If you did not create this account, you can ignore this message.',
    footer: 'Sent because an account was created at The Digital Atrium.',
  },
  es: {
    subject: 'Bienvenido a The Digital Atrium',
    heading: 'Bienvenido',
    greeting: (name: string) => `Hola ${name},`,
    body: '¡Bienvenido a The Digital Atrium!\nUna mezcla de Pinterest, Canva, Figma y PureRef.\n\nUna herramienta rápida y flexible, ideal para lluvias de ideas, diagramas y mucho más.',
    action: 'Entrar en The Digital Atrium',
    footnote: 'Si no creaste esta cuenta, puedes ignorar este mensaje.',
    footer: 'Se envía porque se creó una cuenta en The Digital Atrium.',
  },
  'pt-BR': {
    subject: 'Bem-vindo ao Digital Atrium',
    heading: 'Bem-vindo',
    greeting: (name: string) => `Olá ${name},`,
    body: 'Bem-vindo ao Digital Atrium!\nUma mistura de Pinterest, Canva, Figma e PureRef.\n\nUma ferramenta rápida e flexível, ótima para brainstorming, elaboração de ideias, diagramas e muito mais.',
    action: 'Entrar no Digital Atrium',
    footnote: 'Se você não criou esta conta, pode ignorar esta mensagem.',
    footer: 'Enviado porque uma conta foi criada no Digital Atrium.',
  },
  'pt-PT': {
    subject: 'Bem-vindo ao Digital Atrium',
    heading: 'Bem-vindo',
    greeting: (name: string) => `Olá ${name},`,
    body: 'Bem-vindo ao Digital Atrium!\nUma mistura de Pinterest, Canva, Figma e PureRef.\n\nUma ferramenta rápida e flexível, excelente para brainstorming, conceção de ideias, diagramas e muito mais.',
    action: 'Entrar no Digital Atrium',
    footnote: 'Se não criaste esta conta, podes ignorar esta mensagem.',
    footer: 'Enviado porque foi criada uma conta no Digital Atrium.',
  },
  fr: {
    subject: 'Bienvenue dans The Digital Atrium',
    heading: 'Bienvenue',
    greeting: (name: string) => `Bonjour ${name},`,
    body: 'Bienvenue dans The Digital Atrium !\nUn mélange de Pinterest, Canva, Figma et PureRef.\n\nUn outil rapide et flexible, idéal pour le brainstorming, la conception d’idées, les diagrammes et bien plus encore.',
    action: 'Entrer dans The Digital Atrium',
    footnote: 'Si vous n’avez pas créé ce compte, vous pouvez ignorer ce message.',
    footer: 'Envoyé parce qu’un compte a été créé sur The Digital Atrium.',
  },
  de: {
    subject: 'Willkommen bei The Digital Atrium',
    heading: 'Willkommen',
    greeting: (name: string) => `Hallo ${name},`,
    body: 'Willkommen bei The Digital Atrium!\nEine Mischung aus Pinterest, Canva, Figma und PureRef.\n\nEin schnelles, flexibles Werkzeug — großartig für Brainstorming, das Ausarbeiten von Ideen, Diagramme und vieles mehr.',
    action: 'The Digital Atrium betreten',
    footnote: 'Wenn du dieses Konto nicht erstellt hast, kannst du diese Nachricht ignorieren.',
    footer: 'Gesendet, weil bei The Digital Atrium ein Konto angelegt wurde.',
  },
  it: {
    subject: 'Benvenuto in The Digital Atrium',
    heading: 'Benvenuto',
    greeting: (name: string) => `Ciao ${name},`,
    body: 'Benvenuto in The Digital Atrium!\nUn mix di Pinterest, Canva, Figma e PureRef.\n\nUno strumento rapido e flessibile, perfetto per il brainstorming, l’ideazione, i diagrammi e molto altro.',
    action: 'Entra in The Digital Atrium',
    footnote: 'Se non hai creato tu questo account, puoi ignorare questo messaggio.',
    footer: 'Inviato perché è stato creato un account su The Digital Atrium.',
  },
  ru: {
    subject: 'Добро пожаловать в The Digital Atrium',
    heading: 'Добро пожаловать',
    greeting: (name: string) => `Здравствуйте, ${name},`,
    body: 'Добро пожаловать в The Digital Atrium!\nСмесь Pinterest, Canva, Figma и PureRef.\n\nБыстрый и гибкий инструмент, отлично подходящий для мозгового штурма, проработки идей, диаграмм и многого другого.',
    action: 'Войти в The Digital Atrium',
    footnote: 'Если вы не создавали эту учётную запись, просто проигнорируйте это письмо.',
    footer: 'Отправлено потому, что в The Digital Atrium был создан аккаунт.',
  },
  zh: {
    subject: '欢迎来到 The Digital Atrium',
    heading: '欢迎',
    greeting: (name: string) => `${name}，你好：`,
    body: '欢迎来到 The Digital Atrium！\n它融合了 Pinterest、Canva、Figma 和 PureRef。\n\n它快、灵活，很适合用来发散思路、理清想法、画图表，以及别的许多事情。',
    action: '进入 The Digital Atrium',
    footnote: '如果这个账号不是你注册的，忽略这封邮件就好。',
    footer: '因为有人在 The Digital Atrium 注册了账号，所以你收到这封邮件。',
  },
  ja: {
    subject: 'The Digital Atrium へようこそ',
    heading: 'ようこそ',
    greeting: (name: string) => `${name} さん、`,
    body: 'The Digital Atrium へようこそ！\nPinterest、Canva、Figma、PureRef を混ぜたような道具です。\n\n速くて自由の利く道具で、発想を広げたり、考えを整理したり、図を描いたりするのに向いています。',
    action: 'The Digital Atrium に入る',
    footnote: 'このアカウントに心当たりがなければ、このメールは無視してかまいません。',
    footer: 'The Digital Atrium でアカウントが作成されたため、このメールをお送りしています。',
  },
  ko: {
    subject: 'The Digital Atrium에 오신 것을 환영합니다',
    heading: '환영합니다',
    greeting: (name: string) => `${name}님, 안녕하세요.`,
    body: 'The Digital Atrium에 오신 것을 환영합니다!\nPinterest, Canva, Figma, PureRef를 섞어 놓은 도구예요.\n\n빠르고 자유로워서, 생각을 펼치고 정리하고 도표를 그리는 데 잘 맞아요.',
    action: 'The Digital Atrium에 들어가기',
    footnote: '이 계정을 만든 적이 없다면 이 메일은 무시하셔도 됩니다.',
    footer: 'The Digital Atrium에서 계정이 생성되어 보내드립니다.',
  },
} satisfies Record<string, Welcome>

export type WelcomeLanguage = keyof typeof WELCOME_COPY
