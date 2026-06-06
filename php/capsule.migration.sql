CREATE TABLE IF NOT EXISTS time_capsules (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  openid VARCHAR(64) NOT NULL,
  open_date DATE NOT NULL,
  title VARCHAR(128) NOT NULL DEFAULT '',
  message TEXT,
  photo_urls JSON,
  is_opened TINYINT UNSIGNED DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_openid (openid),
  INDEX idx_open_date (open_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
