// The goodbye sent when an account is deleted: by delete-account for an
// existing account, and by the rooms worker for a Google account
// (workers/rooms/src/mail.ts imports this same file). Plain data, so both
// can: each draws it with renderAtriumEmail. Sent only once the deletion has
// happened, to the address the account had -- the footnote is there for the
// one case that matters, a deletion its owner didn't make.

export interface Goodbye {
  subject: string
  heading: string
  greeting: (name: string) => string
  body: string
  action: string
  footnote: string
  footer: string
}

const SUPPORT = 'thedigitalatrium@gmail.com'

export const GOODBYE_COPY = {
  en: {
    subject: 'Goodbye from The Digital Atrium',
    heading: 'Goodbye',
    greeting: (name: string) => `Hello ${name},`,
    body: 'Your account has been deleted, as you asked.\n\nThank you for the time you spent in The Digital Atrium, and for everything you gathered, sketched and shared there. It meant a lot to have you with us.\n\nIf you ever want to come back, the door stays open: you can make a new account whenever you like.',
    action: 'Visit The Digital Atrium',
    footnote: `If you did not delete your account, write to ${SUPPORT} straight away.`,
    footer: 'Sent because an account at The Digital Atrium was deleted.',
  },
  es: {
    subject: 'Hasta pronto desde The Digital Atrium',
    heading: 'Hasta pronto',
    greeting: (name: string) => `Hola, ${name}:`,
    body: 'Tu cuenta se ha eliminado, como pediste.\n\nGracias por el tiempo que pasaste en The Digital Atrium y por todo lo que reuniste, bocetaste y compartiste allí. Fue un gusto tenerte con nosotros.\n\nSi algún día quieres volver, la puerta sigue abierta: puedes crear una cuenta nueva cuando quieras.',
    action: 'Visitar The Digital Atrium',
    footnote: `Si no eliminaste tu cuenta, escribe de inmediato a ${SUPPORT}.`,
    footer: 'Enviado porque se eliminó una cuenta de The Digital Atrium.',
  },
  'pt-BR': {
    subject: 'Até logo, do The Digital Atrium',
    heading: 'Até logo',
    greeting: (name: string) => `Olá, ${name},`,
    body: 'Sua conta foi excluída, como você pediu.\n\nObrigado pelo tempo que você passou no The Digital Atrium e por tudo o que reuniu, rascunhou e compartilhou por lá. Foi muito bom ter você conosco.\n\nSe um dia quiser voltar, a porta continua aberta: você pode criar uma nova conta quando quiser.',
    action: 'Visitar o The Digital Atrium',
    footnote: `Se não foi você quem excluiu a conta, escreva para ${SUPPORT} imediatamente.`,
    footer: 'Enviado porque uma conta do The Digital Atrium foi excluída.',
  },
  'pt-PT': {
    subject: 'Até breve, do The Digital Atrium',
    heading: 'Até breve',
    greeting: (name: string) => `Olá, ${name},`,
    body: 'A sua conta foi eliminada, como pediu.\n\nObrigado pelo tempo que passou no The Digital Atrium e por tudo o que reuniu, esboçou e partilhou por lá. Foi muito bom tê-lo connosco.\n\nSe um dia quiser voltar, a porta continua aberta: pode criar uma nova conta quando quiser.',
    action: 'Visitar o The Digital Atrium',
    footnote: `Se não foi o próprio a eliminar a conta, escreva para ${SUPPORT} de imediato.`,
    footer: 'Enviado porque uma conta do The Digital Atrium foi eliminada.',
  },
  fr: {
    subject: 'Au revoir, de la part de The Digital Atrium',
    heading: 'Au revoir',
    greeting: (name: string) => `Bonjour ${name},`,
    body: 'Votre compte a été supprimé, comme vous l’avez demandé.\n\nMerci pour le temps passé dans The Digital Atrium, et pour tout ce que vous y avez rassemblé, esquissé et partagé. Ce fut un plaisir de vous avoir parmi nous.\n\nSi vous souhaitez revenir un jour, la porte reste ouverte : vous pouvez créer un nouveau compte quand vous le voulez.',
    action: 'Visiter The Digital Atrium',
    footnote: `Si vous n’avez pas supprimé votre compte, écrivez immédiatement à ${SUPPORT}.`,
    footer: 'Envoyé parce qu’un compte de The Digital Atrium a été supprimé.',
  },
  de: {
    subject: 'Auf Wiedersehen von The Digital Atrium',
    heading: 'Auf Wiedersehen',
    greeting: (name: string) => `Hallo ${name},`,
    body: 'Dein Konto wurde gelöscht, wie gewünscht.\n\nDanke für die Zeit, die du im Digital Atrium verbracht hast, und für alles, was du dort gesammelt, skizziert und geteilt hast. Es war schön, dich dabeizuhaben.\n\nWenn du irgendwann zurückkommen möchtest, steht die Tür offen: Du kannst jederzeit ein neues Konto anlegen.',
    action: 'The Digital Atrium besuchen',
    footnote: `Wenn du dein Konto nicht gelöscht hast, schreib sofort an ${SUPPORT}.`,
    footer: 'Gesendet, weil ein Konto bei The Digital Atrium gelöscht wurde.',
  },
  it: {
    subject: 'Arrivederci da The Digital Atrium',
    heading: 'Arrivederci',
    greeting: (name: string) => `Ciao ${name},`,
    body: 'Il tuo account è stato eliminato, come hai chiesto.\n\nGrazie per il tempo trascorso in The Digital Atrium e per tutto ciò che vi hai raccolto, abbozzato e condiviso. È stato bello averti con noi.\n\nSe un giorno vorrai tornare, la porta resta aperta: puoi creare un nuovo account quando vuoi.',
    action: 'Visita The Digital Atrium',
    footnote: `Se non hai eliminato tu l’account, scrivi subito a ${SUPPORT}.`,
    footer: 'Inviato perché un account di The Digital Atrium è stato eliminato.',
  },
  ru: {
    subject: 'До свидания от The Digital Atrium',
    heading: 'До свидания',
    greeting: (name: string) => `Здравствуйте, ${name}!`,
    body: 'Ваш аккаунт удалён, как вы и просили.\n\nСпасибо за время, проведённое в The Digital Atrium, и за всё, что вы там собирали, набрасывали и чем делились. Нам было очень приятно, что вы были с нами.\n\nЕсли когда-нибудь захотите вернуться, дверь открыта: новый аккаунт можно создать в любое время.',
    action: 'Открыть The Digital Atrium',
    footnote: `Если вы не удаляли свой аккаунт, немедленно напишите на ${SUPPORT}.`,
    footer: 'Отправлено, потому что аккаунт в The Digital Atrium был удалён.',
  },
  zh: {
    subject: '来自 The Digital Atrium 的告别',
    heading: '再见',
    greeting: (name: string) => `${name}，你好：`,
    body: '你的账号已按你的要求删除。\n\n感谢你在 The Digital Atrium 度过的时光，以及你在这里收集、勾勒和分享的一切。很高兴曾与你同行。\n\n如果哪天想回来，大门始终敞开：你随时可以创建新账号。',
    action: '访问 The Digital Atrium',
    footnote: `如果删除账号的不是你本人，请立即写信至 ${SUPPORT}。`,
    footer: '因 The Digital Atrium 的一个账号被删除而发送。',
  },
  ja: {
    subject: 'The Digital Atrium からのお別れ',
    heading: 'さようなら',
    greeting: (name: string) => `${name} さん`,
    body: 'ご依頼のとおり、アカウントを削除しました。\n\nThe Digital Atrium で過ごしてくださった時間と、そこで集め、描き、共有してくださったすべてに感謝します。ご一緒できてうれしかったです。\n\nまたいつでも戻ってきてください。新しいアカウントはいつでも作れます。',
    action: 'The Digital Atrium を開く',
    footnote: `ご自身でアカウントを削除していない場合は、すぐに ${SUPPORT} までご連絡ください。`,
    footer: 'The Digital Atrium のアカウントが削除されたため送信しています。',
  },
  ko: {
    subject: 'The Digital Atrium에서 보내는 작별 인사',
    heading: '안녕히 가세요',
    greeting: (name: string) => `${name} 님, 안녕하세요.`,
    body: '요청하신 대로 계정이 삭제되었습니다.\n\nThe Digital Atrium에서 보낸 시간과, 그곳에서 모으고 스케치하고 나눈 모든 것에 감사드립니다. 함께해 주셔서 정말 기뻤습니다.\n\n언젠가 돌아오고 싶으시면 문은 언제나 열려 있습니다. 언제든 새 계정을 만들 수 있어요.',
    action: 'The Digital Atrium 방문하기',
    footnote: `계정을 직접 삭제하지 않으셨다면 즉시 ${SUPPORT}로 연락해 주세요.`,
    footer: 'The Digital Atrium 계정이 삭제되어 발송되었습니다.',
  },
} satisfies Record<string, Goodbye>

export type GoodbyeLanguage = keyof typeof GOODBYE_COPY
