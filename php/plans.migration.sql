-- 旅行计划：新增「结束日期」与「封面图」字段
-- 在服务器数据库执行一次即可（需先部署本 PR 的 php 文件）
-- MySQL 8.0+ 支持 IF NOT EXISTS；旧版本请去掉 IF NOT EXISTS 后单独执行

ALTER TABLE `trip_plans`
  ADD COLUMN IF NOT EXISTS `plan_date_end` DATE NULL AFTER `plan_date`,
  ADD COLUMN IF NOT EXISTS `cover_image_url` VARCHAR(512) NOT NULL DEFAULT '' AFTER `plan_date_end`;
