-- Map of Us · 点菜功能相关表
-- 与现有 journeys/anniversaries 等表互不影响，全部新增。
-- 字符集与现有表保持一致：utf8mb4 / utf8mb4_unicode_ci

-- 小程序用户（微信快捷登录后写入）
CREATE TABLE IF NOT EXISTS `app_users` (
  `openid`     VARCHAR(64)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `nickname`   VARCHAR(64)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `avatar_url` VARCHAR(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 菜品分类
CREATE TABLE IF NOT EXISTS `dish_categories` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_visible` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cat_visible_order` (`is_visible`, `sort_order`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 菜品
CREATE TABLE IF NOT EXISTS `dishes` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `category_id`  INT NOT NULL,
  `name`         VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description`  VARCHAR(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `price`        DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  `image_url`    VARCHAR(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `is_available` TINYINT(1) NOT NULL DEFAULT 1,
  `is_recommended` TINYINT(1) NOT NULL DEFAULT 0,
  `spicy_level`  TINYINT NOT NULL DEFAULT 0,
  `portion`      VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `sort_order`   INT NOT NULL DEFAULT 0,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dish_cat` (`category_id`, `is_available`, `sort_order`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 订单
CREATE TABLE IF NOT EXISTS `orders` (
  `id`           VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_openid`  VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `nickname`     VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `remark`       VARCHAR(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `item_count`   INT NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `status`       VARCHAR(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_user` (`user_openid`, `created_at`),
  KEY `idx_order_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 订单明细（下单时对菜名/价格做快照，菜品后续改动不影响历史订单）
CREATE TABLE IF NOT EXISTS `order_items` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `order_id`   VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dish_id`    INT NOT NULL DEFAULT 0,
  `dish_name`  VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `price`      DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  `qty`        INT NOT NULL DEFAULT 1,
  `remark`     VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_item_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 老库升级：为已存在的 dishes 表补充菜品标签列（推荐 / 辣度 / 分量）。
-- 若列已存在，重复执行会报错，可忽略；或先 SHOW COLUMNS 判断后再执行。
ALTER TABLE `dishes`
  ADD COLUMN `is_recommended` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_available`,
  ADD COLUMN `spicy_level` TINYINT NOT NULL DEFAULT 0 AFTER `is_recommended`,
  ADD COLUMN `portion` VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' AFTER `spicy_level`;
