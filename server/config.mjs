import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 4177),
  mysql: {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    socketPath: process.env.MYSQL_SOCKET || undefined,
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "design_prompt_gallery",
    multipleStatements: false,
  },
  admin: {
    email: process.env.APP_ADMIN_EMAIL || "xiaojiang",
    password: process.env.APP_ADMIN_PASSWORD || "change-me-admin-password",
  },
};
