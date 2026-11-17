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
