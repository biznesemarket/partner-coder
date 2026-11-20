import { createTransport, type Transporter } from "nodemailer";

import type { Env } from "@partner-coder/config";

export interface OtpMail {
  readonly email: string;
  readonly otp: string;
  readonly type: "sign-in" | "email-verification" | "forget-password" | "change-email";
}

export interface MagicLinkMail {
  readonly email: string;
  readonly url: string;
  readonly token: string;
}

export interface VendorPasswordResetMail {
  readonly email: string;
  readonly url: string;
  readonly ttlMinutes: number;
}

export interface AuthMailer {
  sendOtp(mail: OtpMail): Promise<void>;
  sendMagicLink(mail: MagicLinkMail): Promise<void>;
  sendVendorPasswordReset(mail: VendorPasswordResetMail): Promise<void>;
}

/** Тестовая почта: сохраняет письма в памяти, ничего не отправляет. */
export class MemoryMailer implements AuthMailer {
  readonly otps: OtpMail[] = [];
  readonly magicLinks: MagicLinkMail[] = [];
  readonly vendorPasswordResets: VendorPasswordResetMail[] = [];

  async sendOtp(mail: OtpMail): Promise<void> {
    this.otps.push(mail);
  }

  async sendMagicLink(mail: MagicLinkMail): Promise<void> {
    this.magicLinks.push(mail);
  }

  async sendVendorPasswordReset(mail: VendorPasswordResetMail): Promise<void> {
    this.vendorPasswordResets.push(mail);
  }
}

/** SMTP-почта: локально Mailpit, в staging/prod — внешний SMTP. */
export class SmtpMailer implements AuthMailer {
  private readonly transporter: Transporter;

  constructor(private readonly env: Env) {
    this.transporter = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      ...(env.SMTP_USER && env.SMTP_PASSWORD
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
        : {}),
    });
  }

  async sendOtp(mail: OtpMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.env.SMTP_FROM,
      to: mail.email,
      subject: "Код входа в «Партнёр кодер»",
      text:
        `Код для входа: ${mail.otp}\n\n` +
        `Код действует 10 минут. Если вы не запрашивали вход, просто игнорируйте письмо.`,
    });
  }

  async sendMagicLink(mail: MagicLinkMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.env.SMTP_FROM,
      to: mail.email,
      subject: "Ссылка для входа в «Партнёр кодер»",
      text:
        `Откройте ссылку для входа: ${mail.url}\n\n` +
        `Ссылка одноразовая и действует ограниченное время. ` +
        `Если вы не запрашивали вход, просто игнорируйте письмо.`,
    });
  }

  async sendVendorPasswordReset(mail: VendorPasswordResetMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.env.SMTP_FROM,
      to: mail.email,
      subject: "Доступ к консоли вендора «Партнёр кодер»",
      text:
        `Откройте ссылку для сброса пароля: ${mail.url}\n\n` +
        `Ссылка действует ${mail.ttlMinutes} минут. Если вы не запрашивали сброс пароля, ` +
        `просто игнорируйте письмо.`,
    });
  }
}
