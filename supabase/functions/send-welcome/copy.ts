// What the welcome says, in the languages the app speaks.
//
// Kept beside the function rather than in src/locales, because an Edge
// Function cannot import from the app bundle and a copy of 1,187 keys to reach
// six of them would be worse than this. The glossary still applies: The
// Digital Atrium, Atrium and Trace stay as they are.
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
    body: 'Your account is confirmed, so the door is open.\n\nAn atrium is a room you fill with the things you want to keep — images, video, PDFs, links, notes — arranged however makes sense to you. Make one, drop something into it, and move it around until it looks right.\n\nNothing here has to be finished.',
    action: 'Enter the Atrium',
    footnote: 'If you did not create this account, you can ignore this message and nothing further will happen.',
    footer: 'Sent because an account was created at The Digital Atrium.',
  },
  es: {
    subject: 'Bienvenido a The Digital Atrium',
    heading: 'Bienvenido',
    greeting: (name: string) => `Hola ${name},`,
    body: 'Tu cuenta está confirmada, así que la puerta está abierta.\n\nUn atrium es una sala que llenas con lo que quieres guardar — imágenes, vídeo, PDF, enlaces, notas — colocado como a ti te tenga sentido. Crea uno, suelta algo dentro y muévelo hasta que se vea bien.\n\nAquí nada tiene que estar terminado.',
    action: 'Entrar en el Atrium',
    footnote: 'Si no creaste esta cuenta, puedes ignorar este mensaje y no pasará nada más.',
    footer: 'Se envía porque se creó una cuenta en The Digital Atrium.',
  },
  'pt-BR': {
    subject: 'Bem-vindo ao The Digital Atrium',
    heading: 'Bem-vindo',
    greeting: (name: string) => `Olá ${name},`,
    body: 'Sua conta está confirmada, então a porta está aberta.\n\nUm atrium é uma sala que você enche com o que quer guardar — imagens, vídeos, PDFs, links, anotações — arrumado do jeito que fizer sentido para você. Crie um, jogue algo lá dentro e vá mexendo até ficar bom.\n\nAqui nada precisa estar pronto.',
    action: 'Entrar no Atrium',
    footnote: 'Se você não criou esta conta, pode ignorar esta mensagem que nada mais acontece.',
    footer: 'Enviado porque uma conta foi criada no The Digital Atrium.',
  },
  'pt-PT': {
    subject: 'Bem-vindo ao The Digital Atrium',
    heading: 'Bem-vindo',
    greeting: (name: string) => `Olá ${name},`,
    body: 'A sua conta está confirmada, por isso a porta está aberta.\n\nUm atrium é uma sala que enche com aquilo que quer guardar — imagens, vídeo, PDF, links, notas — disposto como lhe fizer sentido. Crie um, largue lá alguma coisa e vá mexendo até ficar bem.\n\nAqui nada tem de estar acabado.',
    action: 'Entrar no Atrium',
    footnote: 'Se não foi você que criou esta conta, pode ignorar esta mensagem e nada mais acontecerá.',
    footer: 'Enviado porque foi criada uma conta no The Digital Atrium.',
  },
  fr: {
    subject: 'Bienvenue dans The Digital Atrium',
    heading: 'Bienvenue',
    greeting: (name: string) => `Bonjour ${name},`,
    body: 'Votre compte est confirmé, la porte est donc ouverte.\n\nUn atrium est une salle que vous remplissez de ce que vous voulez garder — images, vidéos, PDF, liens, notes — disposé comme cela vous parle. Créez-en un, déposez-y quelque chose, et déplacez-le jusqu’à ce que ce soit juste.\n\nIci, rien n’a besoin d’être fini.',
    action: 'Entrer dans l’Atrium',
    footnote: 'Si vous n’avez pas créé ce compte, ignorez ce message : rien d’autre ne se produira.',
    footer: 'Envoyé parce qu’un compte a été créé sur The Digital Atrium.',
  },
  de: {
    subject: 'Willkommen im The Digital Atrium',
    heading: 'Willkommen',
    greeting: (name: string) => `Hallo ${name},`,
    body: 'Dein Konto ist bestätigt, die Tür steht offen.\n\nEin Atrium ist ein Raum, den du mit dem füllst, was du behalten willst — Bilder, Video, PDFs, Links, Notizen — angeordnet, wie es für dich Sinn ergibt. Leg eines an, wirf etwas hinein und schieb es herum, bis es stimmt.\n\nHier muss nichts fertig sein.',
    action: 'Ins Atrium',
    footnote: 'Wenn du dieses Konto nicht angelegt hast, ignoriere diese Nachricht einfach — es passiert nichts weiter.',
    footer: 'Gesendet, weil im The Digital Atrium ein Konto angelegt wurde.',
  },
  it: {
    subject: 'Benvenuto in The Digital Atrium',
    heading: 'Benvenuto',
    greeting: (name: string) => `Ciao ${name},`,
    body: 'Il tuo account è confermato, quindi la porta è aperta.\n\nUn atrium è una stanza che riempi con le cose che vuoi tenere — immagini, video, PDF, link, appunti — disposte come ha senso per te. Creane uno, buttaci dentro qualcosa e spostalo finché non torna.\n\nQui niente deve essere finito.',
    action: 'Entra nell’Atrium',
    footnote: 'Se non hai creato tu questo account, puoi ignorare questo messaggio: non succederà altro.',
    footer: 'Inviato perché è stato creato un account su The Digital Atrium.',
  },
  ru: {
    subject: 'Добро пожаловать в The Digital Atrium',
    heading: 'Добро пожаловать',
    greeting: (name: string) => `Здравствуйте, ${name}!`,
    body: 'Ваш аккаунт подтверждён — дверь открыта.\n\nAtrium — это комната, которую вы наполняете тем, что хотите сохранить: изображениями, видео, PDF, ссылками, заметками, — расставленным так, как удобно вам. Создайте свой, бросьте туда что-нибудь и двигайте, пока не станет как надо.\n\nЗдесь ничто не обязано быть законченным.',
    action: 'Войти в Atrium',
    footnote: 'Если вы не создавали этот аккаунт, просто не обращайте внимания на это письмо — больше ничего не произойдёт.',
    footer: 'Отправлено потому, что в The Digital Atrium был создан аккаунт.',
  },
  zh: {
    subject: '欢迎来到 The Digital Atrium',
    heading: '欢迎',
    greeting: (name: string) => `${name}，你好：`,
    body: '你的账号已经确认，门开着了。\n\natrium 是一间房间，你把想留住的东西放进去——图片、视频、PDF、链接、笔记——怎么摆由你决定。建一个，往里丢点东西，然后挪到你觉得对的位置。\n\n这里没有什么非得做完不可。',
    action: '进入 Atrium',
    footnote: '如果这个账号不是你注册的，忽略这封邮件就好，不会再有别的事发生。',
    footer: '因为有人在 The Digital Atrium 注册了账号，所以你收到这封邮件。',
  },
  ja: {
    subject: 'The Digital Atrium へようこそ',
    heading: 'ようこそ',
    greeting: (name: string) => `${name} さん、`,
    body: 'アカウントの確認が済みました。扉は開いています。\n\natrium は、とっておきたいものを入れていく部屋です——画像、動画、PDF、リンク、メモ。並べ方はあなたの好きなように。ひとつ作って、何か放り込んで、しっくりくるまで動かしてみてください。\n\nここでは、何ひとつ完成している必要はありません。',
    action: 'Atrium に入る',
    footnote: 'このアカウントに心当たりがなければ、このメールは無視してかまいません。それ以上は何も起こりません。',
    footer: 'The Digital Atrium でアカウントが作られたため、お送りしています。',
  },
  ko: {
    subject: 'The Digital Atrium에 오신 것을 환영해요',
    heading: '환영해요',
    greeting: (name: string) => `${name} 님, 안녕하세요.`,
    body: '계정 확인이 끝났어요. 문은 열려 있어요.\n\natrium은 간직하고 싶은 것들을 넣어 두는 방이에요 — 이미지, 영상, PDF, 링크, 메모. 어떻게 놓을지는 당신 마음이에요. 하나 만들고, 뭐든 하나 던져 넣고, 마음에 들 때까지 옮겨 보세요.\n\n여기서는 무엇도 완성되어 있을 필요가 없어요.',
    action: 'Atrium에 들어가기',
    footnote: '이 계정을 만든 적이 없다면 이 메일은 그냥 넘기셔도 돼요. 더 일어나는 일은 없어요.',
    footer: 'The Digital Atrium에서 계정이 만들어져 보내드려요.',
  },
} satisfies Record<string, Welcome>

export type WelcomeLanguage = keyof typeof WELCOME_COPY
