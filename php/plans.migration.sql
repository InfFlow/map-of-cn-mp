-- 旅行计划：新增「结束日期」与「封面图」字段
-- 在服务器数据库执行一次即可（需先部署本 PR 的 php 文件）
--
-- 注意：MySQL 8.0 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
-- （这是 MariaDB 的语法）。下面用存储过程在执行前检查列是否已存在，
-- 因此可安全重复执行。

DROP PROCEDURE IF EXISTS `__add_plan_cols`;
DELIMITER //
CREATE PROCEDURE `__add_plan_cols`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_plans' AND COLUMN_NAME = 'plan_date_end'
  ) THEN
    ALTER TABLE `trip_plans` ADD COLUMN `plan_date_end` DATE NULL AFTER `plan_date`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_plans' AND COLUMN_NAME = 'cover_image_url'
  ) THEN
    ALTER TABLE `trip_plans` ADD COLUMN `cover_image_url` VARCHAR(512) NOT NULL DEFAULT '' AFTER `plan_date_end`;
  END IF;
END //
DELIMITER ;

CALL `__add_plan_cols`();
DROP PROCEDURE IF EXISTS `__add_plan_cols`;
