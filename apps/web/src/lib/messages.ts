import type { VendorRole, VendorUserStatus } from "./vendor-types";

export const roles: Record<VendorRole, string> = {
  superadmin: "Суперадминистратор",
  finance: "Финансы",
  support: "Поддержка",
  readonly: "Только чтение",
};

export const statuses: Record<VendorUserStatus, string> = {
  invited: "Приглашён",
  active: "Активен",
  suspended: "Заблокирован",
  disabled: "Отключён",
};

export const common = {
  appName: "Партнер кодер",
  console: "Консоль вендора",
  loading: "Загрузка…",
  retry: "Повторить",
  logout: "Выйти",
  close: "Закрыть",
  skipToContent: "Перейти к содержимому",
  openMenu: "Открыть меню",
  userMenu: "Меню пользователя",
  navigation: "Навигация",
  mainNavigation: "Основная навигация",
  consoleNavigation: "Разделы консоли",
} as const;

export const nav = {
  profile: "Профиль",
  security: "Безопасность",
} as const;

export const auth = {
  loginTitle: "Вход в консоль",
  loginDescription: "Войдите, чтобы продолжить работу.",
  inactiveReason: "Учётная запись заблокирована. Обратитесь к администратору.",
  sessionExpiredReason: "Сессия истекла. Войдите снова.",
  emailLabel: "Email",
  passwordLabel: "Пароль",
  emailRequired: "Введите email",
  passwordRequired: "Введите пароль",
  signIn: "Войти",
  signingIn: "Входим…",
  passkey: "Войти с ключом доступа",
  passkeyPending: "Ожидаем ключ доступа…",
  forgotPassword: "Забыли пароль?",
  forgotPasswordTitle: "Восстановление пароля",
  forgotPasswordDescription: "Укажите email — мы отправим ссылку для сброса пароля.",
  forgotPasswordSubmit: "Отправить ссылку",
  forgotPasswordPending: "Отправляем…",
  forgotPasswordSent: "Если адрес зарегистрирован, письмо со ссылкой отправлено.",
  forgotPasswordBack: "Вернуться ко входу",
  twoFactorTitle: "Подтверждение входа",
  twoFactorDescription: "Введите код из приложения-аутентификатора.",
  codeLabel: "Код подтверждения",
  codeHint: "Шесть цифр из приложения.",
  codeRequired: "Введите шестизначный код",
  twoFactorSubmit: "Подтвердить",
  twoFactorPending: "Проверяем…",
  backupCode: "Использовать резервный код",
  backupCodeLabel: "Резервный код",
  backupCodeHint: "Один из сохранённых резервных кодов.",
  backupCodeRequired: "Введите резервный код",
  useTotpCode: "Вернуться к коду из приложения",
  backToPassword: "Вернуться ко входу",
  passwordTooShort: (minLength: number): string =>
    `Пароль должен содержать минимум ${minLength} символов`,
  passwordsMismatch: "Пароли не совпадают",
  resetTitle: "Новый пароль",
  resetDescription: "Придумайте новый пароль для входа в консоль.",
  newPasswordLabel: "Новый пароль",
  confirmPasswordLabel: "Повторите пароль",
  passwordHint: (minLength: number): string => `Минимум ${minLength} символов.`,
  confirmPasswordRequired: "Повторите пароль",
  resetSubmit: "Установить пароль",
  resetPending: "Сохраняем…",
  resetSuccessTitle: "Пароль установлен",
  resetSuccessDescription: "Теперь можно войти в консоль с новым паролем.",
  resetInvalidTitle: "Ссылка недействительна или истекла",
  resetInvalidDescription: "Запросите новую ссылку для сброса пароля.",
  resetIncompleteTitle: "Ссылка неполная",
  resetIncompleteDescription:
    "В ссылке отсутствует токен. Запросите новую ссылку для сброса пароля.",
  resetRequestNew: "Запросить новую ссылку",
  resetToLogin: "Перейти ко входу",
} as const;

export const errors = {
  invalidCredentials: "Неверный email или пароль",
  inactive: "Учётная запись заблокирована. Обратитесь к администратору.",
  tooManyAttempts: "Слишком много попыток. Попробуйте позже.",
  invalidCode: "Неверный код подтверждения",
  sessionExpired: "Сессия истекла — переход на вход",
  sessionExpiredRestart: "Сессия входа истекла. Начните заново.",
  sessionNotFresh: "Сессия устарела. Войдите заново.",
  totpAlreadyEnabled: "TOTP уже включён",
  passkeyAlreadyRegistered: "Этот ключ доступа уже зарегистрирован",
  cancelled: "Действие отменено",
  mfaRequired: "Сначала включите TOTP",
  stepUpRequired: "Требуется повторное подтверждение пароля",
  serviceUnavailable: "Сервис временно недоступен",
  serviceUnavailableDescription: "Не удалось получить данные. Повторите попытку позже.",
  signOutFailed: "Не удалось выйти. Попробуйте ещё раз.",
  generic: "Не удалось выполнить действие. Попробуйте ещё раз.",
} as const;

export const messages = {
  roles,
  statuses,
  common,
  nav,
  auth,
  errors,
} as const;
