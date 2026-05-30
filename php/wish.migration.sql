-- 心愿清单：新增「完成日期」字段（完成打卡时记录日期，用于年度回顾）
-- 在服务器数据库执行一次即可（需先部署本 PR 的 php 文件）
-- MySQL 8.0.24 不支持 ADD COLUMN IF NOT EXISTS，用存储过程做幂等，可重复执行

DROP PROCEDURE IF EXISTS `add_wish_completed_date`;
DELIMITER //
CREATE PROCEDURE `add_wish_completed_date`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'desire_list'
      AND COLUMN_NAME = 'completed_date'
  ) THEN
    ALTER TABLE `desire_list` ADD COLUMN `completed_date` DATE NULL AFTER `done`;
  END IF;
END //
DELIMITER ;
CALL `add_wish_completed_date`();
DROP PROCEDURE IF EXISTS `add_wish_completed_date`;
