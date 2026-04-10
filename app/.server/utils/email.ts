import nodemailer from "nodemailer";

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) {
    console.warn("Email: SMTP_HOST, SMTP_USER, or SMTP_PASS not configured — email skipped");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendWheelPrizeEmail({
  to,
  prizeName,
  discountCode,
  shopName,
}: {
  to: string;
  prizeName: string;
  discountCode: string;
  shopName: string;
}): Promise<void> {
  const transporter = createTransporter();
  if (!transporter) return;

  const hasCode = !!discountCode;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #eee;">
      <div style="background:linear-gradient(135deg,#5C6AC4,#9c6ac4);padding:32px 24px;text-align:center;">
        <div style="font-size:48px;margin-bottom:8px;">🎰</div>
        <h1 style="color:#fff;margin:0;font-size:24px;">You Won!</h1>
        <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">${prizeName}</p>
      </div>
      <div style="padding:32px 24px;text-align:center;">
        ${hasCode ? `
          <p style="color:#444;font-size:15px;margin:0 0 20px;">Use this code at checkout:</p>
          <div style="background:#f4f6ff;border:2px dashed #5C6AC4;border-radius:8px;padding:16px 24px;display:inline-block;margin-bottom:24px;">
            <span style="font-size:24px;font-weight:800;letter-spacing:3px;color:#5C6AC4;">${discountCode}</span>
          </div>
          <p style="color:#888;font-size:13px;margin:0 0 24px;">Copy and paste this code at checkout to claim your reward.</p>
        ` : `
          <p style="color:#444;font-size:15px;margin:0 0 24px;">Thanks for spinning! Better luck next time 🤞</p>
        `}
        <a href="https://${shopName}/collections/all"
           style="background:#5C6AC4;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block;">
          Shop Now
        </a>
      </div>
      <div style="padding:16px 24px;text-align:center;border-top:1px solid #eee;">
        <p style="color:#aaa;font-size:12px;margin:0;">You received this because you participated in our Spin &amp; Win at ${shopName}.</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"${shopName}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to,
    subject: hasCode ? `🎉 Your prize from ${shopName}: ${prizeName}` : `Thanks for spinning at ${shopName}!`,
    html,
  });
}
