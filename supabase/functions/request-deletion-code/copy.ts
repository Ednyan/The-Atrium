// What the deletion code email says, in the languages the app speaks.
//
// The tone is deliberately flat. This message arrives either because somebody
// is deleting their account, in which case they want the six digits and nothing
// else, or because somebody else is trying to -- in which case the only useful
// sentence is the one saying nothing has happened yet and what to do about it.
// Warmth would be wrong in both readings.
//
// The code goes in `quote`, which the renderer sets apart from the message.
// Deliberately not in the subject line: subjects show in notifications, on
// lock screens, and over shoulders.

export interface DeletionCode {
  subject: string
  heading: string
  greeting: (name: string) => string
  body: string
  footnote: string
  footer: string
}

export const DELETION_CODE_COPY = {
  en: {
    subject: 'Confirm deleting your account',
    heading: 'Deleting your account',
    greeting: (name: string) => `Hello ${name},`,
    body: 'Somebody asked to delete your account at The Digital Atrium. Enter the code below to confirm.\n\nThe code lasts 10 minutes. Nothing has been deleted yet.',
    footnote: 'If this was not you, ignore this message and your account stays as it is. Changing your password is worth doing if you did not expect it.',
    footer: 'Sent because account deletion was requested at The Digital Atrium.',
  },
  es: {
    subject: 'Confirma la eliminación de tu cuenta',
    heading: 'Eliminar tu cuenta',
    greeting: (name: string) => `Hola ${name},`,
    body: 'Alguien ha pedido eliminar tu cuenta en The Digital Atrium. Introduce el código de abajo para confirmarlo.\n\nEl código dura 10 minutos. Todavía no se ha eliminado nada.',
    footnote: 'Si no has sido tú, ignora este mensaje y tu cuenta seguirá igual. Si no lo esperabas, conviene que cambies tu contraseña.',
    footer: 'Se envía porque se solicitó eliminar una cuenta en The Digital Atrium.',
  },
  'pt-BR': {
    subject: 'Confirme a exclusão da sua conta',
    heading: 'Excluir sua conta',
    greeting: (name: string) => `Olá ${name},`,
    body: 'Alguém pediu para excluir sua conta no Digital Atrium. Digite o código abaixo para confirmar.\n\nO código vale por 10 minutos. Nada foi excluído ainda.',
    footnote: 'Se não foi você, ignore esta mensagem e sua conta continua como está. Se não esperava por isso, vale a pena trocar sua senha.',
    footer: 'Enviado porque foi solicitada a exclusão de uma conta no Digital Atrium.',
  },
  'pt-PT': {
    subject: 'Confirma a eliminação da tua conta',
    heading: 'Eliminar a tua conta',
    greeting: (name: string) => `Olá ${name},`,
    body: 'Alguém pediu para eliminar a tua conta no Digital Atrium. Introduz o código abaixo para confirmar.\n\nO código dura 10 minutos. Ainda não foi eliminado nada.',
    footnote: 'Se não foste tu, ignora esta mensagem e a tua conta fica como está. Se não estavas à espera disto, vale a pena mudares a palavra-passe.',
    footer: 'Enviado porque foi pedida a eliminação de uma conta no Digital Atrium.',
  },
  fr: {
    subject: 'Confirmez la suppression de votre compte',
    heading: 'Supprimer votre compte',
    greeting: (name: string) => `Bonjour ${name},`,
    body: 'Quelqu’un a demandé la suppression de votre compte sur The Digital Atrium. Saisissez le code ci-dessous pour confirmer.\n\nLe code est valable 10 minutes. Rien n’a encore été supprimé.',
    footnote: 'Si ce n’était pas vous, ignorez ce message : votre compte reste tel quel. Si vous ne vous y attendiez pas, changer votre mot de passe est une bonne idée.',
    footer: 'Envoyé parce qu’une suppression de compte a été demandée sur The Digital Atrium.',
  },
  de: {
    subject: 'Löschung deines Kontos bestätigen',
    heading: 'Konto löschen',
    greeting: (name: string) => `Hallo ${name},`,
    body: 'Jemand hat die Löschung deines Kontos bei The Digital Atrium angefordert. Gib den Code unten ein, um das zu bestätigen.\n\nDer Code gilt 10 Minuten. Es wurde noch nichts gelöscht.',
    footnote: 'Warst du das nicht, ignoriere diese Nachricht — dein Konto bleibt, wie es ist. Wenn du das nicht erwartet hast, ändere lieber dein Passwort.',
    footer: 'Gesendet, weil bei The Digital Atrium eine Kontolöschung angefordert wurde.',
  },
  it: {
    subject: 'Conferma l’eliminazione del tuo account',
    heading: 'Eliminare il tuo account',
    greeting: (name: string) => `Ciao ${name},`,
    body: 'Qualcuno ha chiesto di eliminare il tuo account su The Digital Atrium. Inserisci il codice qui sotto per confermare.\n\nIl codice dura 10 minuti. Non è ancora stato eliminato niente.',
    footnote: 'Se non sei stato tu, ignora questo messaggio: il tuo account resta com’è. Se non te lo aspettavi, conviene cambiare la password.',
    footer: 'Inviato perché è stata richiesta l’eliminazione di un account su The Digital Atrium.',
  },
  ru: {
    subject: 'Подтвердите удаление учётной записи',
    heading: 'Удаление учётной записи',
    greeting: (name: string) => `Здравствуйте, ${name},`,
    body: 'Кто-то запросил удаление вашей учётной записи в The Digital Atrium. Введите код ниже, чтобы подтвердить.\n\nКод действует 10 минут. Пока ничего не удалено.',
    footnote: 'Если это были не вы, просто проигнорируйте это письмо — учётная запись останется на месте. Если вы этого не ожидали, лучше сменить пароль.',
    footer: 'Отправлено потому, что в The Digital Atrium запросили удаление учётной записи.',
  },
  zh: {
    subject: '确认删除你的账号',
    heading: '删除账号',
    greeting: (name: string) => `${name}，你好：`,
    body: '有人请求删除你在 The Digital Atrium 的账号。请输入下面的验证码来确认。\n\n验证码 10 分钟内有效。目前还没有删除任何东西。',
    footnote: '如果这不是你本人操作，忽略这封邮件即可，账号不会有任何变化。如果你并不知情，建议改一下密码。',
    footer: '因为有人请求删除 The Digital Atrium 的账号，所以你收到这封邮件。',
  },
  ja: {
    subject: 'アカウント削除の確認',
    heading: 'アカウントの削除',
    greeting: (name: string) => `${name} さん、`,
    body: 'The Digital Atrium のアカウントを削除する要求がありました。確認のため、下のコードを入力してください。\n\nコードの有効期限は 10 分です。まだ何も削除されていません。',
    footnote: 'お心当たりがなければ、このメールは無視してかまいません。アカウントはそのまま残ります。覚えのない要求であれば、パスワードの変更をおすすめします。',
    footer: 'The Digital Atrium でアカウントの削除が要求されたため、このメールをお送りしています。',
  },
  ko: {
    subject: '계정 삭제 확인',
    heading: '계정 삭제',
    greeting: (name: string) => `${name}님, 안녕하세요.`,
    body: 'The Digital Atrium 계정을 삭제해 달라는 요청이 있었습니다. 확인하려면 아래 코드를 입력해 주세요.\n\n코드는 10분 동안 유효합니다. 아직 삭제된 것은 없습니다.',
    footnote: '본인이 아니라면 이 메일은 무시하셔도 됩니다. 계정은 그대로 유지됩니다. 예상하지 못한 요청이라면 비밀번호를 바꾸시는 편이 좋습니다.',
    footer: 'The Digital Atrium에서 계정 삭제가 요청되어 보내드립니다.',
  },
} satisfies Record<string, DeletionCode>

export type DeletionCodeLanguage = keyof typeof DELETION_CODE_COPY
