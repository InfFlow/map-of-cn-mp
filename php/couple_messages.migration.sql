-- 情侣留言板：仅登录后的两个人在小程序内共看共写
CREATE TABLE IF NOT EXISTS couple_messages (
  id          VARCHAR(32)   NOT NULL PRIMARY KEY,
  openid      VARCHAR(64)   NOT NULL DEFAULT '',
  nickname    VARCHAR(64)   NOT NULL DEFAULT '',
  avatar_url  VARCHAR(512)  NOT NULL DEFAULT '',
  content     TEXT          NOT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  DATETIME      DEFAULT NULL,
  INDEX idx_visible_created (deleted_at, created_at),
  INDEX idx_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
