export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
    balance_cents INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS prompt_cases (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_number INT NULL,
    category_id VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(120) NULL,
    source_url TEXT NULL,
    image_path TEXT NULL,
    prompt MEDIUMTEXT NOT NULL,
    source_file VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cases_category (category_id),
    INDEX idx_cases_number (case_number),
    CONSTRAINT fk_cases_category FOREIGN KEY (category_id) REFERENCES categories(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS case_usage_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    source VARCHAR(32) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_case_usage_case_created (case_id, created_at),
    INDEX idx_case_usage_user_created (user_id, created_at),
    CONSTRAINT fk_case_usage_case FOREIGN KEY (case_id) REFERENCES prompt_cases(id) ON DELETE CASCADE,
    CONSTRAINT fk_case_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS providers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    default_model VARCHAR(120) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS model_prices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    provider_id BIGINT UNSIGNED NOT NULL,
    model VARCHAR(120) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    unit_price_cents INT NOT NULL DEFAULT 0,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_provider_model (provider_id, model),
    CONSTRAINT fk_prices_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS wallet_transactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    type ENUM('recharge', 'consume', 'refund') NOT NULL,
    amount_cents INT NOT NULL,
    balance_after_cents INT NOT NULL,
    note VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wallet_user_created (user_id, created_at),
    CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS creations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    case_id BIGINT UNSIGNED NULL,
    provider_id BIGINT UNSIGNED NULL,
    model VARCHAR(120) NOT NULL,
    prompt MEDIUMTEXT NOT NULL,
    charge_cents INT NOT NULL,
    status ENUM('succeeded', 'failed') NOT NULL,
    image_url TEXT NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_creations_user_created (user_id, created_at),
    CONSTRAINT fk_creations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_creations_case FOREIGN KEY (case_id) REFERENCES prompt_cases(id) ON DELETE SET NULL,
    CONSTRAINT fk_creations_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export const videoTaskSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS video_tasks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    model VARCHAR(160) NOT NULL,
    prompt MEDIUMTEXT NOT NULL,
    charge_cents INT NOT NULL DEFAULT 0,
    status ENUM('queued', 'running', 'succeeded', 'failed') NOT NULL DEFAULT 'queued',
    provider_task_id VARCHAR(190) NOT NULL,
    video_url TEXT NULL,
    error_message TEXT NULL,
    params_json MEDIUMTEXT NULL,
    charged TINYINT(1) NOT NULL DEFAULT 0,
    creation_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_video_tasks_user_created (user_id, created_at),
    INDEX idx_video_tasks_provider_task (provider_task_id),
    CONSTRAINT fk_video_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_video_tasks_creation FOREIGN KEY (creation_id) REFERENCES creations(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export const caseUsageSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS case_usage_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    source VARCHAR(32) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_case_usage_case_created (case_id, created_at),
    INDEX idx_case_usage_user_created (user_id, created_at),
    CONSTRAINT fk_case_usage_case FOREIGN KEY (case_id) REFERENCES prompt_cases(id) ON DELETE CASCADE,
    CONSTRAINT fk_case_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export const appSettingSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
    setting_value TEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export const aiNewsSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS ai_news_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    digest_date DATE NOT NULL,
    category VARCHAR(40) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    source_name VARCHAR(120) NULL,
    source_url TEXT NOT NULL,
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_ai_news_source (source_url(190)),
    INDEX idx_ai_news_date (digest_date, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

/* 支付体系表：服务启动时自动确保存在（老库无需重新初始化） */
export const paymentSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS payment_configs (
    channel VARCHAR(20) NOT NULL PRIMARY KEY,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    mode ENUM('mock', 'production') NOT NULL DEFAULT 'mock',
    config_json MEDIUMTEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS payment_orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_no VARCHAR(64) NOT NULL UNIQUE,
    user_id BIGINT UNSIGNED NULL,
    type ENUM('recharge', 'paygen') NOT NULL,
    channel VARCHAR(20) NOT NULL,
    amount_cents INT NOT NULL,
    status ENUM('pending', 'paid', 'expired', 'failed') NOT NULL DEFAULT 'pending',
    qr_text TEXT NULL,
    credited TINYINT(1) NOT NULL DEFAULT 0,
    used TINYINT(1) NOT NULL DEFAULT 0,
    subject VARCHAR(190) NULL,
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pay_orders_user (user_id, created_at),
    INDEX idx_pay_orders_status (status, created_at),
    CONSTRAINT fk_pay_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS withdrawals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    amount_cents INT NOT NULL,
    note VARCHAR(255) NULL,
    status ENUM('pending', 'done') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    done_at TIMESTAMP NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];
