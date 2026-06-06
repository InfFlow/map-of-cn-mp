<?php
declare(strict_types=1);

/**
 * Map of Us · 运营后台
 * 单文件管理后台：总览 / 足迹 / 纪念日 / 心愿 / 行程 / 菜品 / 分类 / 订单。
 * 依赖 _private/db.php 与 _private/config.php（含 admin_user / admin_pass_hash）。
 */

session_start();
require_once dirname(__DIR__) . '/_private/db.php';
$config = require dirname(__DIR__) . '/_private/config.php';

$uploadDir = $config['upload_dir'] ?? (dirname(__DIR__) . '/uploads');
$uploadBase = $config['upload_base'] ?? '/uploads';

function csrf(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return $_SESSION['csrf'];
}

function check_csrf(): void
{
    $t = $_POST['csrf'] ?? '';
    if (!is_string($t) || !hash_equals($_SESSION['csrf'] ?? '', $t)) {
        http_response_code(400);
        exit('bad csrf');
    }
}

function is_logged_in(): bool
{
    return !empty($_SESSION['admin']);
}

function redirect(string $view): void
{
    header('Location: index.php?view=' . urlencode($view));
    exit;
}

$action = $_POST['action'] ?? '';
$view = $_GET['view'] ?? (is_logged_in() ? 'overview' : 'login');
$flash = '';

function gen_id(string $prefix): string
{
    return $prefix . date('YmdHis') . '_' . bin2hex(random_bytes(3));
}

/* ---------- 动作处理 ---------- */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();

    if ($action === 'login') {
        $u = trim((string) ($_POST['username'] ?? ''));
        $p = (string) ($_POST['password'] ?? '');
        if ($u === ($config['admin_user'] ?? '') && password_verify($p, $config['admin_pass_hash'] ?? '')) {
            $_SESSION['admin'] = $u;
            redirect('overview');
        }
        $flash = '账号或密码错误';
        $view = 'login';
    } elseif ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        header('Location: index.php');
        exit;
    } elseif (is_logged_in()) {
        $pdo = db();

        if ($action === 'add_category') {
            $name = trim((string) ($_POST['name'] ?? ''));
            $sort = (int) ($_POST['sort_order'] ?? 0);
            if ($name !== '') {
                $st = $pdo->prepare('INSERT INTO dish_categories (name, sort_order) VALUES (?, ?)');
                $st->execute([$name, $sort]);
            }
            redirect('categories');
        } elseif ($action === 'toggle_category') {
            $id = (int) ($_POST['id'] ?? 0);
            $pdo->prepare('UPDATE dish_categories SET is_visible = 1 - is_visible WHERE id = ?')->execute([$id]);
            redirect('categories');
        } elseif ($action === 'del_category') {
            $id = (int) ($_POST['id'] ?? 0);
            $cnt = $pdo->prepare('SELECT COUNT(*) FROM dishes WHERE category_id = ?');
            $cnt->execute([$id]);
            if ((int) $cnt->fetchColumn() === 0) {
                $pdo->prepare('DELETE FROM dish_categories WHERE id = ?')->execute([$id]);
            }
            redirect('categories');
        } elseif ($action === 'add_dish' || $action === 'edit_dish') {
            $id = (int) ($_POST['id'] ?? 0);
            $catId = (int) ($_POST['category_id'] ?? 0);
            $name = trim((string) ($_POST['name'] ?? ''));
            $desc = trim((string) ($_POST['description'] ?? ''));
            $price = (float) ($_POST['price'] ?? 0);
            $sort = (int) ($_POST['sort_order'] ?? 0);
            $imageUrl = trim((string) ($_POST['image_url'] ?? ''));
            $isRec = !empty($_POST['is_recommended']) ? 1 : 0;
            $spicy = (int) ($_POST['spicy_level'] ?? 0);
            if ($spicy < 0 || $spicy > 3) {
                $spicy = 0;
            }
            $portion = trim((string) ($_POST['portion'] ?? ''));

            // 图片上传（可选）
            if (!empty($_FILES['image']['tmp_name']) && is_uploaded_file($_FILES['image']['tmp_name'])) {
                $tmp = $_FILES['image']['tmp_name'];
                $info = @getimagesize($tmp);
                $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
                if ($info && isset($allowed[$info['mime']])) {
                    $dir = $uploadDir . '/dishes';
                    if (!is_dir($dir)) {
                        @mkdir($dir, 0755, true);
                    }
                    $fn = date('Ymd') . '_' . bin2hex(random_bytes(6)) . '.' . $allowed[$info['mime']];
                    if (move_uploaded_file($tmp, $dir . '/' . $fn)) {
                        $imageUrl = rtrim($uploadBase, '/') . '/dishes/' . $fn;
                    }
                }
            }

            if ($name !== '' && $catId > 0) {
                if ($action === 'add_dish') {
                    $st = $pdo->prepare(
                        'INSERT INTO dishes (category_id, name, description, price, image_url, is_recommended, spicy_level, portion, sort_order)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                    );
                    $st->execute([$catId, $name, $desc, $price, $imageUrl, $isRec, $spicy, $portion, $sort]);
                } else {
                    $st = $pdo->prepare(
                        'UPDATE dishes SET category_id=?, name=?, description=?, price=?, image_url=?, is_recommended=?, spicy_level=?, portion=?, sort_order=? WHERE id=?'
                    );
                    $st->execute([$catId, $name, $desc, $price, $imageUrl, $isRec, $spicy, $portion, $sort, $id]);
                }
            }
            redirect('dishes');
        } elseif ($action === 'toggle_dish') {
            $id = (int) ($_POST['id'] ?? 0);
            $pdo->prepare('UPDATE dishes SET is_available = 1 - is_available WHERE id = ?')->execute([$id]);
            redirect('dishes');
        } elseif ($action === 'del_dish') {
            $id = (int) ($_POST['id'] ?? 0);
            $pdo->prepare('DELETE FROM dishes WHERE id = ?')->execute([$id]);
            redirect('dishes');
        } elseif ($action === 'set_order_status') {
            $id = (string) ($_POST['id'] ?? '');
            $status = (string) ($_POST['status'] ?? 'pending');
            $allowed = ['pending', 'accepted', 'done', 'canceled'];
            if (in_array($status, $allowed, true)) {
                $pdo->prepare('UPDATE orders SET status = ? WHERE id = ?')->execute([$status, $id]);
            }
            redirect('orders');

        /* ---------- 足迹回忆 ---------- */
        } elseif ($action === 'add_journey' || $action === 'update_journey') {
            $city = mb_substr(trim((string) ($_POST['city'] ?? '')), 0, 64);
            $province = mb_substr(trim((string) ($_POST['province'] ?? '')), 0, 64);
            $date = trim((string) ($_POST['travel_date'] ?? ''));
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                $date = date('Y-m-d');
            }
            $season = mb_substr(trim((string) ($_POST['season'] ?? '')), 0, 32);
            $weather = mb_substr(trim((string) ($_POST['weather'] ?? '')), 0, 64);
            $landmark = mb_substr(trim((string) ($_POST['landmark'] ?? '')), 0, 128);
            $lat = round((float) ($_POST['latitude'] ?? 0), 6);
            $lng = round((float) ($_POST['longitude'] ?? 0), 6);
            $tone = mb_substr(trim((string) ($_POST['cover_tone'] ?? '')), 0, 64) ?: 'tone-slate';
            $title = mb_substr(trim((string) ($_POST['title'] ?? '')), 0, 128);
            $intro = trim((string) ($_POST['intro'] ?? ''));
            if ($city !== '' && $province !== '') {
                if ($action === 'add_journey') {
                    $id = gen_id('j_');
                    $next = (int) $pdo->query('SELECT COALESCE(MAX(sort_order),0)+1 FROM journeys')->fetchColumn();
                    $pdo->prepare(
                        'INSERT INTO journeys (id, city, province, travel_date, season, weather, landmark, latitude, longitude, cover_tone, title, intro, sort_order, is_visible)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)'
                    )->execute([$id, $city, $province, $date, $season, $weather, $landmark, $lat, $lng, $tone, $title, $intro, $next]);
                } else {
                    $id = (string) ($_POST['id'] ?? '');
                    if ($id !== '') {
                        $pdo->prepare(
                            'UPDATE journeys SET city=?, province=?, travel_date=?, season=?, weather=?, landmark=?, latitude=?, longitude=?, cover_tone=?, title=?, intro=? WHERE id=?'
                        )->execute([$city, $province, $date, $season, $weather, $landmark, $lat, $lng, $tone, $title, $intro, $id]);
                    }
                }
            }
            redirect('journeys');
        } elseif ($action === 'toggle_journey') {
            $id = (string) ($_POST['id'] ?? '');
            $pdo->prepare('UPDATE journeys SET is_visible = 1 - is_visible WHERE id = ?')->execute([$id]);
            redirect('journeys');
        } elseif ($action === 'del_journey') {
            $id = (string) ($_POST['id'] ?? '');
            $pdo->prepare('DELETE FROM journeys WHERE id = ?')->execute([$id]);
            redirect('journeys');

        /* ---------- 纪念日 ---------- */
        } elseif ($action === 'add_anniversary' || $action === 'update_anniversary') {
            $label = mb_substr(trim((string) ($_POST['label'] ?? '')), 0, 128);
            $date = trim((string) ($_POST['event_date'] ?? ''));
            $city = mb_substr(trim((string) ($_POST['city'] ?? '')), 0, 64);
            $repeat = !empty($_POST['repeat_yearly']) ? 1 : 0;
            if ($label !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                if ($action === 'add_anniversary') {
                    $id = gen_id('a_');
                    $next = (int) $pdo->query('SELECT COALESCE(MAX(sort_order),0)+1 FROM anniversaries')->fetchColumn();
                    $pdo->prepare('INSERT INTO anniversaries (id, label, event_date, city, repeat_yearly, sort_order) VALUES (?,?,?,?,?,?)')
                        ->execute([$id, $label, $date, $city, $repeat, $next]);
                } else {
                    $id = (string) ($_POST['id'] ?? '');
                    if ($id !== '') {
                        $pdo->prepare('UPDATE anniversaries SET label=?, event_date=?, city=?, repeat_yearly=? WHERE id=?')
                            ->execute([$label, $date, $city, $repeat, $id]);
                    }
                }
            }
            redirect('anniversaries');
        } elseif ($action === 'del_anniversary') {
            $id = (string) ($_POST['id'] ?? '');
            $pdo->prepare('DELETE FROM anniversaries WHERE id = ?')->execute([$id]);
            redirect('anniversaries');

        /* ---------- 心愿清单 ---------- */
        } elseif ($action === 'add_wish' || $action === 'update_wish') {
            $placeName = mb_substr(trim((string) ($_POST['place_name'] ?? '')), 0, 128);
            $province = mb_substr(trim((string) ($_POST['province'] ?? '')), 0, 64);
            $city = mb_substr(trim((string) ($_POST['city'] ?? '')), 0, 64);
            $memo = trim((string) ($_POST['memo'] ?? ''));
            $lat = ($_POST['latitude'] ?? '') !== '' ? (float) $_POST['latitude'] : null;
            $lng = ($_POST['longitude'] ?? '') !== '' ? (float) $_POST['longitude'] : null;
            if ($placeName !== '') {
                if ($action === 'add_wish') {
                    $id = gen_id('wish_');
                    $next = (int) $pdo->query('SELECT COALESCE(MAX(sort_order),0)+1 FROM desire_list')->fetchColumn();
                    $pdo->prepare(
                        'INSERT INTO desire_list (id, openid, place_name, province, city, latitude, longitude, memo, sort_order)
                         VALUES (?,?,?,?,?,?,?,?,?)'
                    )->execute([$id, 'admin', $placeName, $province, $city, $lat, $lng, $memo, $next]);
                } else {
                    $id = (string) ($_POST['id'] ?? '');
                    if ($id !== '') {
                        $pdo->prepare('UPDATE desire_list SET place_name=?, province=?, city=?, latitude=?, longitude=?, memo=? WHERE id=?')
                            ->execute([$placeName, $province, $city, $lat, $lng, $memo, $id]);
                    }
                }
            }
            redirect('wishes');
        } elseif ($action === 'toggle_wish') {
            $id = (string) ($_POST['id'] ?? '');
            $pdo->prepare(
                'UPDATE desire_list
                 SET completed_date = CASE WHEN done = 0 THEN CURDATE() ELSE NULL END,
                     done = 1 - done
                 WHERE id = ?'
            )->execute([$id]);
            redirect('wishes');
        } elseif ($action === 'del_wish') {
            $id = (string) ($_POST['id'] ?? '');
            $pdo->prepare('DELETE FROM desire_list WHERE id = ?')->execute([$id]);
            redirect('wishes');

        /* ---------- 行程计划（显隐 / 删除） ---------- */
        } elseif ($action === 'toggle_plan') {
            $id = (string) ($_POST['id'] ?? '');
            $pdo->prepare('UPDATE trip_plans SET is_visible = 1 - is_visible WHERE id = ?')->execute([$id]);
            redirect('plans');
        } elseif ($action === 'del_plan') {
            $id = (string) ($_POST['id'] ?? '');
            $pdo->prepare('DELETE FROM trip_plans WHERE id = ?')->execute([$id]);
            redirect('plans');
        } elseif ($action === 'save_settings') {
            $cfgPath = dirname(__DIR__) . '/_private/config.php';
            $cfg = require $cfgPath;
            // 只更新非空提交的字段，空值则保留原值
            foreach (['deepseek_key', 'amap_key'] as $k) {
                $v = trim((string) ($_POST[$k] ?? ''));
                if ($v !== '') { $cfg[$k] = $v; }
            }
            $cfg['ai_enabled'] = isset($_POST['ai_enabled']);
            $out = "<?php\nreturn " . var_export($cfg, true) . ";\n";
            file_put_contents($cfgPath, $out);
            $flash = '配置已保存';
            redirect('settings');
        }
    }
}

if (!is_logged_in()) {
    $view = 'login';
}

function h(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

$statusLabels = ['pending' => '待处理', 'accepted' => '已接单', 'done' => '已完成', 'canceled' => '已取消'];
?>
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Map of Us · 运营后台</title>
<style>
  :root{
    --bg:#f4f1ea; --paper:#faf8f3; --surface:#fff; --ink:#1b1712; --ink-2:#5b5447;
    --muted:#8c8475; --faint:#b1a892; --line:rgba(27,23,18,.13); --line-soft:rgba(27,23,18,.07);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased;line-height:1.6;font-size:15px}
  a{color:inherit}
  .serif{font-family:Georgia,"Songti SC","STSong",serif}
  .wrap{max-width:920px;margin:0 auto;padding:0 20px 80px}
  header.top{border-bottom:1px solid var(--ink);margin-bottom:26px}
  .masthead{display:flex;align-items:baseline;justify-content:space-between;
    max-width:920px;margin:0 auto;padding:22px 20px 14px}
  .masthead .brand{font-family:Georgia,serif;font-weight:700;letter-spacing:1px;font-size:20px}
  .masthead .vol{font-size:12px;letter-spacing:3px;color:var(--muted);text-transform:uppercase}
  nav.tabs{display:flex;gap:6px;max-width:920px;margin:0 auto;padding:0 20px 14px;flex-wrap:wrap}
  nav.tabs a{padding:7px 16px;border:1px solid var(--line);font-size:13px;letter-spacing:1px;
    text-decoration:none;background:var(--surface);transition:.18s}
  nav.tabs a:hover{border-color:var(--ink)}
  nav.tabs a.active{background:var(--ink);color:var(--bg);border-color:var(--ink)}
  nav.tabs .tab-sep{width:1px;align-self:stretch;background:var(--line);margin:2px 4px}
  nav.tabs form{margin-left:auto}
  nav.tabs button.linkbtn{padding:7px 16px;border:1px solid var(--line);font-size:13px;
    letter-spacing:1px;background:var(--surface);cursor:pointer}
  h1.title{font-family:Georgia,serif;font-size:30px;font-weight:700;margin:6px 0 18px}
  .card{background:var(--surface);border:1px solid var(--line);padding:22px;margin-bottom:20px}
  .card h2{font-family:Georgia,serif;font-size:17px;margin:0 0 16px;font-weight:700;
    display:flex;align-items:center;gap:10px}
  .eyebrow{font-size:11px;letter-spacing:3px;color:var(--faint);text-transform:uppercase;font-weight:700}
  label{display:block;font-size:12px;letter-spacing:1px;color:var(--ink-2);margin:0 0 6px;text-transform:uppercase}
  input[type=text],input[type=number],input[type=password],textarea,select{
    width:100%;padding:11px 13px;border:1px solid var(--line);background:var(--paper);
    font-size:15px;font-family:inherit;color:var(--ink);border-radius:0}
  textarea{min-height:64px;resize:vertical}
  .row{display:flex;gap:14px;flex-wrap:wrap}
  .row > div{flex:1;min-width:160px;margin-bottom:14px}
  .btn{display:inline-block;padding:11px 22px;background:var(--ink);color:var(--bg);border:1px solid var(--ink);
    font-size:13px;letter-spacing:2px;cursor:pointer;text-transform:uppercase;font-weight:700}
  .btn.ghost{background:var(--surface);color:var(--ink)}
  .btn.sm{padding:6px 12px;letter-spacing:1px;font-size:12px}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--line-soft);font-size:14px;vertical-align:middle}
  th{font-size:11px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;font-weight:700}
  .thumb{width:54px;height:54px;object-fit:cover;border:1px solid var(--line);background:var(--paper)}
  .thumb.ph{display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:10px}
  .pill{display:inline-block;padding:3px 10px;border:1px solid var(--line);font-size:11px;letter-spacing:1px}
  .pill.off{color:var(--muted);background:var(--paper)}
  .pill.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
  .muted{color:var(--muted)}
  .price{font-family:Georgia,serif}
  .flash{background:var(--ink);color:var(--bg);padding:10px 14px;margin-bottom:18px;font-size:13px;letter-spacing:1px}
  .inline{display:inline}
  .actions{display:flex;gap:8px;flex-wrap:wrap}
  .login-wrap{max-width:380px;margin:9vh auto 0}
  .hint{font-size:12px;color:var(--muted);margin-top:8px}
  .order-items{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--ink-2)}
  details summary{cursor:pointer;font-size:13px;letter-spacing:1px;color:var(--ink-2)}
  .grid-dish{display:grid;grid-template-columns:1fr;gap:0}
  /* 仪表盘统计卡片 */
  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}
  .stat{display:block;background:var(--surface);border:1px solid var(--line);padding:20px 18px;text-decoration:none;color:inherit;transition:transform .18s,box-shadow .18s,border-color .18s}
  a.stat:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(27,23,18,.08);border-color:var(--ink)}
  .stat-num{font-size:40px;line-height:1;font-weight:700}
  .stat-sub{font-size:20px;color:var(--muted);font-weight:400}
  .stat-lab{font-size:11px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;margin-top:10px}
  .sub{font-size:12px;margin-top:2px}
  .card{transition:box-shadow .18s}
  .btn{transition:transform .12s,opacity .18s}
  .btn:active{transform:scale(.97)}
  @media(max-width:680px){.stat-grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>

<?php if ($view === 'login'): ?>
  <div class="login-wrap">
    <div style="text-align:center;margin-bottom:26px">
      <div class="serif" style="font-weight:700;letter-spacing:1px;font-size:24px">Map of Us</div>
      <div class="eyebrow" style="margin-top:6px">运营后台 · ADMIN</div>
    </div>
    <div class="card">
      <?php if ($flash): ?><div class="flash"><?= h($flash) ?></div><?php endif; ?>
      <form method="post">
        <input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
        <input type="hidden" name="action" value="login">
        <div style="margin-bottom:14px">
          <label>账号</label>
          <input type="text" name="username" autocomplete="username" autofocus>
        </div>
        <div style="margin-bottom:20px">
          <label>密码</label>
          <input type="password" name="password" autocomplete="current-password">
        </div>
        <button class="btn" style="width:100%" type="submit">登录</button>
      </form>
    </div>
  </div>

<?php else: ?>
  <header class="top">
    <div class="masthead">
      <div class="brand">Map of Us</div>
      <div class="vol">运营后台 · ADMIN</div>
    </div>
    <nav class="tabs">
      <a href="index.php?view=overview" class="<?= $view === 'overview' ? 'active' : '' ?>">总览</a>
      <span class="tab-sep"></span>
      <a href="index.php?view=journeys" class="<?= $view === 'journeys' ? 'active' : '' ?>">足迹</a>
      <a href="index.php?view=anniversaries" class="<?= $view === 'anniversaries' ? 'active' : '' ?>">纪念日</a>
      <a href="index.php?view=wishes" class="<?= $view === 'wishes' ? 'active' : '' ?>">心愿</a>
      <a href="index.php?view=plans" class="<?= $view === 'plans' ? 'active' : '' ?>">行程</a>
      <span class="tab-sep"></span>
      <a href="index.php?view=dishes" class="<?= $view === 'dishes' ? 'active' : '' ?>">菜品</a>
      <a href="index.php?view=categories" class="<?= $view === 'categories' ? 'active' : '' ?>">分类</a>
      <a href="index.php?view=orders" class="<?= $view === 'orders' ? 'active' : '' ?>">订单</a>
      <span class="tab-sep"></span>
      <a href="index.php?view=settings" class="<?= $view === 'settings' ? 'active' : '' ?>">系统配置</a>
      <form method="post" style="margin-left:auto">
        <input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
        <input type="hidden" name="action" value="logout">
        <button class="linkbtn" type="submit">退出</button>
      </form>
    </nav>
  </header>
  <div class="wrap">
  <?php
  $pdo = db();

  if ($view === 'overview'):
      $jCount = (int) $pdo->query('SELECT COUNT(*) FROM journeys')->fetchColumn();
      $cityCount = (int) $pdo->query('SELECT COUNT(DISTINCT city) FROM journeys')->fetchColumn();
      $provCount = (int) $pdo->query('SELECT COUNT(DISTINCT province) FROM journeys')->fetchColumn();
      $planCount = (int) $pdo->query('SELECT COUNT(*) FROM trip_plans')->fetchColumn();
      $wishCount = (int) $pdo->query('SELECT COUNT(*) FROM desire_list')->fetchColumn();
      $wishDone = (int) $pdo->query('SELECT COUNT(*) FROM desire_list WHERE done = 1')->fetchColumn();
      $annCount = (int) $pdo->query('SELECT COUNT(*) FROM anniversaries')->fetchColumn();
      $dishCount = (int) $pdo->query('SELECT COUNT(*) FROM dishes')->fetchColumn();
      $orderCount = (int) $pdo->query('SELECT COUNT(*) FROM orders')->fetchColumn();
      $pendingOrders = (int) $pdo->query("SELECT COUNT(*) FROM orders WHERE status = 'pending'")->fetchColumn();
      $recentJourneys = $pdo->query('SELECT city, title, travel_date FROM journeys ORDER BY travel_date DESC, id DESC LIMIT 6')->fetchAll();
  ?>
    <h1 class="title">总览</h1>
    <div class="stat-grid">
      <a class="stat" href="index.php?view=journeys"><div class="stat-num serif"><?= $jCount ?></div><div class="stat-lab">足迹 JOURNEYS</div></a>
      <div class="stat"><div class="stat-num serif"><?= $cityCount ?></div><div class="stat-lab">城市 CITIES</div></div>
      <div class="stat"><div class="stat-num serif"><?= $provCount ?></div><div class="stat-lab">省份 PROVINCES</div></div>
      <a class="stat" href="index.php?view=plans"><div class="stat-num serif"><?= $planCount ?></div><div class="stat-lab">行程 PLANS</div></a>
      <a class="stat" href="index.php?view=wishes"><div class="stat-num serif"><?= $wishDone ?><span class="stat-sub">/<?= $wishCount ?></span></div><div class="stat-lab">心愿达成 WISHES</div></a>
      <a class="stat" href="index.php?view=anniversaries"><div class="stat-num serif"><?= $annCount ?></div><div class="stat-lab">纪念日 DATES</div></a>
      <a class="stat" href="index.php?view=dishes"><div class="stat-num serif"><?= $dishCount ?></div><div class="stat-lab">菜品 DISHES</div></a>
      <a class="stat" href="index.php?view=orders"><div class="stat-num serif"><?= $orderCount ?></div><div class="stat-lab">订单 ORDERS<?= $pendingOrders ? ' · ' . $pendingOrders . ' 待处理' : '' ?></div></a>
    </div>
    <div class="card">
      <h2><span class="eyebrow">最近</span> 最新足迹</h2>
      <table>
        <tr><th>日期</th><th>城市</th><th>标题</th></tr>
        <?php if (!$recentJourneys): ?><tr><td colspan="3" class="muted">还没有足迹，去「足迹」添加第一段回忆。</td></tr><?php endif; ?>
        <?php foreach ($recentJourneys as $r): ?>
          <tr><td class="muted" style="white-space:nowrap"><?= h($r['travel_date']) ?></td><td><?= h($r['city']) ?></td><td class="serif"><?= h($r['title']) ?></td></tr>
        <?php endforeach; ?>
      </table>
    </div>

  <?php elseif ($view === 'journeys'):
      $TONES = ['tone-spring'=>'春','tone-sea'=>'海','tone-water'=>'水','tone-lake'=>'湖','tone-island'=>'屿','tone-city'=>'城','tone-sunset'=>'夕','tone-warm'=>'暖','tone-brick'=>'砖','tone-night'=>'夜','tone-rain'=>'雨','tone-osmanthus'=>'桂','tone-paper'=>'纸','tone-tea'=>'茶','tone-slate'=>'岩','tone-sage'=>'苔','tone-ink'=>'墨'];
      $editId = (string) ($_GET['edit'] ?? '');
      $editJ = null;
      if ($editId !== '') { $st = $pdo->prepare('SELECT * FROM journeys WHERE id = ?'); $st->execute([$editId]); $editJ = $st->fetch() ?: null; }
      $journeys = $pdo->query('SELECT * FROM journeys ORDER BY sort_order ASC, travel_date DESC, id ASC')->fetchAll();
  ?>
    <h1 class="title">足迹回忆</h1>
    <div class="card">
      <h2><span class="eyebrow"><?= $editJ ? '编辑' : '新增' ?></span> <?= $editJ ? '修改足迹' : '添加足迹' ?></h2>
      <form method="post">
        <input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
        <input type="hidden" name="action" value="<?= $editJ ? 'update_journey' : 'add_journey' ?>">
        <?php if ($editJ): ?><input type="hidden" name="id" value="<?= h($editJ['id']) ?>"><?php endif; ?>
        <div class="row">
          <div><label>城市 *</label><input type="text" name="city" value="<?= h($editJ['city'] ?? '') ?>" placeholder="如：杭州"></div>
          <div><label>省份 *</label><input type="text" name="province" value="<?= h($editJ['province'] ?? '') ?>" placeholder="如：浙江"></div>
          <div><label>日期</label><input type="date" name="travel_date" value="<?= h($editJ['travel_date'] ?? date('Y-m-d')) ?>"></div>
        </div>
        <div class="row">
          <div style="flex:2"><label>标题</label><input type="text" name="title" value="<?= h($editJ['title'] ?? '') ?>" placeholder="这段回忆的标题"></div>
          <div><label>地标</label><input type="text" name="landmark" value="<?= h($editJ['landmark'] ?? '') ?>" placeholder="如：西湖"></div>
        </div>
        <div class="row">
          <div><label>季节</label><input type="text" name="season" value="<?= h($editJ['season'] ?? '') ?>" placeholder="春 / 夏 / 秋 / 冬"></div>
          <div><label>天气</label><input type="text" name="weather" value="<?= h($editJ['weather'] ?? '') ?>" placeholder="如：晴"></div>
          <div><label>封面色调</label>
            <select name="cover_tone">
              <?php $curTone = $editJ['cover_tone'] ?? 'tone-slate'; foreach ($TONES as $tk => $tn): ?>
                <option value="<?= h($tk) ?>" <?= $curTone === $tk ? 'selected' : '' ?>><?= h($tn) . ' · ' . h($tk) ?></option>
              <?php endforeach; ?>
            </select>
          </div>
        </div>
        <div class="row">
          <div><label>纬度 latitude</label><input type="number" step="any" name="latitude" value="<?= h((string) ($editJ['latitude'] ?? '')) ?>" placeholder="选填，用于地图"></div>
          <div><label>经度 longitude</label><input type="number" step="any" name="longitude" value="<?= h((string) ($editJ['longitude'] ?? '')) ?>" placeholder="选填，用于地图"></div>
        </div>
        <div class="row"><div style="flex:1 1 100%"><label>简介</label><textarea name="intro" placeholder="写点什么…"><?= h($editJ['intro'] ?? '') ?></textarea></div></div>
        <div class="actions">
          <button class="btn" type="submit"><?= $editJ ? '保存修改' : '添加足迹' ?></button>
          <?php if ($editJ): ?><a class="btn ghost" href="index.php?view=journeys">取消</a><?php endif; ?>
        </div>
        <div class="hint">照片 / 标签 / 备注等富内容建议在小程序「管理」里维护，体验更好。</div>
      </form>
    </div>
    <div class="card">
      <h2><span class="eyebrow">列表</span> 全部足迹（<?= count($journeys) ?>）</h2>
      <table>
        <tr><th>日期</th><th>城市</th><th>标题</th><th>状态</th><th style="text-align:right">操作</th></tr>
        <?php if (!$journeys): ?><tr><td colspan="5" class="muted">还没有足迹。</td></tr><?php endif; ?>
        <?php foreach ($journeys as $j): ?>
          <tr>
            <td class="muted" style="white-space:nowrap"><?= h($j['travel_date']) ?></td>
            <td><?= h($j['city']) ?><div class="sub muted"><?= h($j['province']) ?></div></td>
            <td class="serif" style="font-size:16px"><?= h($j['title']) ?></td>
            <td><span class="pill <?= $j['is_visible'] ? 'on' : 'off' ?>"><?= $j['is_visible'] ? '显示' : '隐藏' ?></span></td>
            <td style="text-align:right"><div class="actions" style="justify-content:flex-end">
              <a class="btn ghost sm" href="index.php?view=journeys&edit=<?= h(urlencode($j['id'])) ?>">编辑</a>
              <form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="toggle_journey"><input type="hidden" name="id" value="<?= h($j['id']) ?>"><button class="btn ghost sm" type="submit"><?= $j['is_visible'] ? '隐藏' : '显示' ?></button></form>
              <form method="post" class="inline" onsubmit="return confirm('删除该足迹？此操作不可恢复')"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="del_journey"><input type="hidden" name="id" value="<?= h($j['id']) ?>"><button class="btn ghost sm" type="submit">删除</button></form>
            </div></td>
          </tr>
        <?php endforeach; ?>
      </table>
    </div>

  <?php elseif ($view === 'anniversaries'):
      $editId = (string) ($_GET['edit'] ?? '');
      $editA = null;
      if ($editId !== '') { $st = $pdo->prepare('SELECT * FROM anniversaries WHERE id = ?'); $st->execute([$editId]); $editA = $st->fetch() ?: null; }
      $anns = $pdo->query('SELECT * FROM anniversaries ORDER BY sort_order ASC, event_date ASC, id ASC')->fetchAll();
  ?>
    <h1 class="title">纪念日</h1>
    <div class="card">
      <h2><span class="eyebrow"><?= $editA ? '编辑' : '新增' ?></span> <?= $editA ? '修改纪念日' : '添加纪念日' ?></h2>
      <form method="post">
        <input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
        <input type="hidden" name="action" value="<?= $editA ? 'update_anniversary' : 'add_anniversary' ?>">
        <?php if ($editA): ?><input type="hidden" name="id" value="<?= h($editA['id']) ?>"><?php endif; ?>
        <div class="row">
          <div style="flex:2"><label>名称 *</label><input type="text" name="label" value="<?= h($editA['label'] ?? '') ?>" placeholder="如：在一起的日子"></div>
          <div><label>日期 *</label><input type="date" name="event_date" value="<?= h($editA['event_date'] ?? '') ?>"></div>
        </div>
        <div class="row">
          <div><label>城市</label><input type="text" name="city" value="<?= h($editA['city'] ?? '') ?>"></div>
          <div style="flex:0 0 auto;align-self:flex-end;padding-bottom:8px"><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;text-transform:none"><input type="checkbox" name="repeat_yearly" value="1" <?= !empty($editA['repeat_yearly']) ? 'checked' : '' ?> style="width:auto"> 每年重复</label></div>
        </div>
        <div class="actions">
          <button class="btn" type="submit"><?= $editA ? '保存修改' : '添加' ?></button>
          <?php if ($editA): ?><a class="btn ghost" href="index.php?view=anniversaries">取消</a><?php endif; ?>
        </div>
      </form>
    </div>
    <div class="card">
      <h2><span class="eyebrow">列表</span> 全部纪念日</h2>
      <table>
        <tr><th>日期</th><th>名称</th><th>城市</th><th>重复</th><th style="text-align:right">操作</th></tr>
        <?php if (!$anns): ?><tr><td colspan="5" class="muted">还没有纪念日。</td></tr><?php endif; ?>
        <?php foreach ($anns as $a): ?>
          <tr>
            <td class="muted" style="white-space:nowrap"><?= h($a['event_date']) ?></td>
            <td class="serif" style="font-size:16px"><?= h($a['label']) ?></td>
            <td><?= h($a['city']) ?></td>
            <td><?= !empty($a['repeat_yearly']) ? '<span class="pill on">每年</span>' : '<span class="pill off">单次</span>' ?></td>
            <td style="text-align:right"><div class="actions" style="justify-content:flex-end">
              <a class="btn ghost sm" href="index.php?view=anniversaries&edit=<?= h(urlencode($a['id'])) ?>">编辑</a>
              <form method="post" class="inline" onsubmit="return confirm('删除该纪念日？')"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="del_anniversary"><input type="hidden" name="id" value="<?= h($a['id']) ?>"><button class="btn ghost sm" type="submit">删除</button></form>
            </div></td>
          </tr>
        <?php endforeach; ?>
      </table>
    </div>

  <?php elseif ($view === 'wishes'):
      $editId = (string) ($_GET['edit'] ?? '');
      $editW = null;
      if ($editId !== '') { $st = $pdo->prepare('SELECT * FROM desire_list WHERE id = ?'); $st->execute([$editId]); $editW = $st->fetch() ?: null; }
      $wishes = $pdo->query('SELECT * FROM desire_list ORDER BY done ASC, sort_order ASC, created_at DESC')->fetchAll();
  ?>
    <h1 class="title">心愿清单</h1>
    <div class="card">
      <h2><span class="eyebrow"><?= $editW ? '编辑' : '新增' ?></span> <?= $editW ? '修改心愿' : '添加心愿' ?></h2>
      <form method="post">
        <input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
        <input type="hidden" name="action" value="<?= $editW ? 'update_wish' : 'add_wish' ?>">
        <?php if ($editW): ?><input type="hidden" name="id" value="<?= h($editW['id']) ?>"><?php endif; ?>
        <div class="row">
          <div style="flex:2"><label>地点名称 *</label><input type="text" name="place_name" value="<?= h($editW['place_name'] ?? '') ?>" placeholder="想去的地方"></div>
          <div><label>省份</label><input type="text" name="province" value="<?= h($editW['province'] ?? '') ?>"></div>
          <div><label>城市</label><input type="text" name="city" value="<?= h($editW['city'] ?? '') ?>"></div>
        </div>
        <div class="row">
          <div><label>纬度 latitude</label><input type="number" step="any" name="latitude" value="<?= h((string) ($editW['latitude'] ?? '')) ?>" placeholder="选填"></div>
          <div><label>经度 longitude</label><input type="number" step="any" name="longitude" value="<?= h((string) ($editW['longitude'] ?? '')) ?>" placeholder="选填"></div>
        </div>
        <div class="row"><div style="flex:1 1 100%"><label>备注</label><textarea name="memo" placeholder="为什么想去 / 怎么去…"><?= h($editW['memo'] ?? '') ?></textarea></div></div>
        <div class="actions">
          <button class="btn" type="submit"><?= $editW ? '保存修改' : '添加心愿' ?></button>
          <?php if ($editW): ?><a class="btn ghost" href="index.php?view=wishes">取消</a><?php endif; ?>
        </div>
      </form>
    </div>
    <div class="card">
      <h2><span class="eyebrow">列表</span> 全部心愿</h2>
      <table>
        <tr><th>状态</th><th>地点</th><th>省市</th><th>备注</th><th style="text-align:right">操作</th></tr>
        <?php if (!$wishes): ?><tr><td colspan="5" class="muted">还没有心愿。</td></tr><?php endif; ?>
        <?php foreach ($wishes as $w): ?>
          <tr>
            <td><span class="pill <?= $w['done'] ? 'on' : 'off' ?>"><?= $w['done'] ? '已达成' : '想去' ?></span><?php if ($w['done'] && $w['completed_date']): ?><div class="sub muted"><?= h($w['completed_date']) ?></div><?php endif; ?></td>
            <td class="serif" style="font-size:16px"><?= h($w['place_name']) ?></td>
            <td class="muted"><?= h(trim(($w['province'] ?? '') . ' ' . ($w['city'] ?? ''))) ?></td>
            <td class="muted"><?= h($w['memo']) ?></td>
            <td style="text-align:right"><div class="actions" style="justify-content:flex-end">
              <form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="toggle_wish"><input type="hidden" name="id" value="<?= h($w['id']) ?>"><button class="btn ghost sm" type="submit"><?= $w['done'] ? '取消达成' : '标记达成' ?></button></form>
              <a class="btn ghost sm" href="index.php?view=wishes&edit=<?= h(urlencode($w['id'])) ?>">编辑</a>
              <form method="post" class="inline" onsubmit="return confirm('删除该心愿？')"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="del_wish"><input type="hidden" name="id" value="<?= h($w['id']) ?>"><button class="btn ghost sm" type="submit">删除</button></form>
            </div></td>
          </tr>
        <?php endforeach; ?>
      </table>
    </div>

  <?php elseif ($view === 'plans'):
      $plans = $pdo->query('SELECT * FROM trip_plans ORDER BY sort_order ASC, created_at DESC, id ASC')->fetchAll();
      $ids = array_column($plans, 'id');
      $stopCount = [];
      if ($ids) {
          $ph = implode(',', array_fill(0, count($ids), '?'));
          $ss = $pdo->prepare("SELECT plan_id, COUNT(*) c FROM plan_stops WHERE plan_id IN ($ph) GROUP BY plan_id");
          $ss->execute($ids);
          foreach ($ss->fetchAll() as $r) { $stopCount[$r['plan_id']] = (int) $r['c']; }
      }
  ?>
    <h1 class="title">行程计划</h1>
    <div class="card"><div class="hint">计划的目的地 / 酒店 / 拖拽排序等编辑在小程序「计划」里完成（体验更好）。这里用于总览、显隐与删除管理。</div></div>
    <div class="card">
      <h2><span class="eyebrow">列表</span> 全部计划（<?= count($plans) ?>）</h2>
      <table>
        <tr><th>日期</th><th>标题</th><th>目的地</th><th>状态</th><th style="text-align:right">操作</th></tr>
        <?php if (!$plans): ?><tr><td colspan="5" class="muted">还没有计划。</td></tr><?php endif; ?>
        <?php foreach ($plans as $p): $range = $p['plan_date']; if (!empty($p['plan_date_end']) && $p['plan_date_end'] !== $p['plan_date']) { $range .= ' → ' . $p['plan_date_end']; } ?>
          <tr>
            <td class="muted" style="white-space:nowrap"><?= h($range ?: '—') ?></td>
            <td class="serif" style="font-size:16px"><?= h($p['title']) ?></td>
            <td><?= (int) ($stopCount[$p['id']] ?? 0) ?> 个</td>
            <td><span class="pill <?= $p['is_visible'] ? 'on' : 'off' ?>"><?= $p['is_visible'] ? '显示' : '隐藏' ?></span></td>
            <td style="text-align:right"><div class="actions" style="justify-content:flex-end">
              <form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="toggle_plan"><input type="hidden" name="id" value="<?= h($p['id']) ?>"><button class="btn ghost sm" type="submit"><?= $p['is_visible'] ? '隐藏' : '显示' ?></button></form>
              <form method="post" class="inline" onsubmit="return confirm('删除该计划？将一并删除其目的地')"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="del_plan"><input type="hidden" name="id" value="<?= h($p['id']) ?>"><button class="btn ghost sm" type="submit">删除</button></form>
            </div></td>
          </tr>
        <?php endforeach; ?>
      </table>
    </div>

  <?php elseif ($view === 'categories'):
      $cats = $pdo->query('SELECT * FROM dish_categories ORDER BY sort_order ASC, id ASC')->fetchAll();
  ?>
    <h1 class="title">分类</h1>
    <div class="card">
      <h2><span class="eyebrow">新增</span> 添加分类</h2>
      <form method="post">
        <input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
        <input type="hidden" name="action" value="add_category">
        <div class="row">
          <div style="flex:2"><label>分类名称</label><input type="text" name="name" placeholder="如：热菜 / 汤 / 主食 / 甜品"></div>
          <div><label>排序（小在前）</label><input type="number" name="sort_order" value="0"></div>
        </div>
        <button class="btn" type="submit">添加分类</button>
      </form>
    </div>
    <div class="card">
      <h2><span class="eyebrow">列表</span> 全部分类</h2>
      <table>
        <tr><th>排序</th><th>名称</th><th>状态</th><th style="text-align:right">操作</th></tr>
        <?php if (!$cats): ?>
          <tr><td colspan="4" class="muted">还没有分类，先在上面添加一个。</td></tr>
        <?php endif; ?>
        <?php foreach ($cats as $c): ?>
          <tr>
            <td class="muted"><?= (int) $c['sort_order'] ?></td>
            <td class="serif" style="font-size:16px"><?= h($c['name']) ?></td>
            <td>
              <span class="pill <?= $c['is_visible'] ? 'on' : 'off' ?>"><?= $c['is_visible'] ? '显示' : '隐藏' ?></span>
            </td>
            <td style="text-align:right">
              <div class="actions" style="justify-content:flex-end">
                <form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="toggle_category"><input type="hidden" name="id" value="<?= (int) $c['id'] ?>"><button class="btn ghost sm" type="submit"><?= $c['is_visible'] ? '隐藏' : '显示' ?></button></form>
                <form method="post" class="inline" onsubmit="return confirm('删除该分类？（仅当分类下无菜品时可删）')"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="del_category"><input type="hidden" name="id" value="<?= (int) $c['id'] ?>"><button class="btn ghost sm" type="submit">删除</button></form>
              </div>
            </td>
          </tr>
        <?php endforeach; ?>
      </table>
    </div>

  <?php elseif ($view === 'orders'):
      $orders = $pdo->query('SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 100')->fetchAll();
      $ids = array_column($orders, 'id');
      $itemsByOrder = [];
      if ($ids) {
          $ph = implode(',', array_fill(0, count($ids), '?'));
          $is = $pdo->prepare("SELECT * FROM order_items WHERE order_id IN ($ph) ORDER BY id ASC");
          $is->execute($ids);
          foreach ($is->fetchAll() as $it) {
              $itemsByOrder[$it['order_id']][] = $it;
          }
      }
  ?>
    <h1 class="title">订单</h1>
    <div class="card">
      <h2><span class="eyebrow">最新</span> 点菜记录</h2>
      <table>
        <tr><th>时间</th><th>点菜人</th><th>内容</th><th>合计</th><th>状态</th><th style="text-align:right">操作</th></tr>
        <?php if (!$orders): ?>
          <tr><td colspan="6" class="muted">还没有订单。</td></tr>
        <?php endif; ?>
        <?php foreach ($orders as $o): $its = $itemsByOrder[$o['id']] ?? []; ?>
          <tr>
            <td class="muted" style="white-space:nowrap"><?= h(date('m-d H:i', strtotime($o['created_at']))) ?></td>
            <td><?= h($o['nickname'] ?: '匿名') ?></td>
            <td>
              <details>
                <summary><?= (int) $o['item_count'] ?> 份 · 展开</summary>
                <ul class="order-items">
                  <?php foreach ($its as $it): ?>
                    <li><?= h($it['dish_name']) ?> × <?= (int) $it['qty'] ?><?= $it['remark'] !== '' ? '（' . h($it['remark']) . '）' : '' ?></li>
                  <?php endforeach; ?>
                </ul>
                <?php if (trim((string) $o['remark']) !== ''): ?><div class="hint">备注：<?= h($o['remark']) ?></div><?php endif; ?>
              </details>
            </td>
            <td class="price"><?= $o['total_amount'] > 0 ? '¥' . number_format((float) $o['total_amount'], 0) : '—' ?></td>
            <td><span class="pill <?= $o['status'] === 'done' ? 'on' : 'off' ?>"><?= h($statusLabels[$o['status']] ?? $o['status']) ?></span></td>
            <td style="text-align:right">
              <form method="post" class="inline">
                <input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
                <input type="hidden" name="action" value="set_order_status">
                <input type="hidden" name="id" value="<?= h($o['id']) ?>">
                <select name="status" onchange="this.form.submit()">
                  <?php foreach ($statusLabels as $k => $v): ?>
                    <option value="<?= h($k) ?>" <?= $o['status'] === $k ? 'selected' : '' ?>><?= h($v) ?></option>
                  <?php endforeach; ?>
                </select>
              </form>
            </td>
          </tr>
        <?php endforeach; ?>
      </table>
    </div>

  <?php elseif ($view === 'dishes'): // dishes
      $cats = $pdo->query('SELECT * FROM dish_categories ORDER BY sort_order ASC, id ASC')->fetchAll();
      $catName = [];
      foreach ($cats as $c) {
          $catName[(int) $c['id']] = $c['name'];
      }
      $editId = (int) ($_GET['edit'] ?? 0);
      $editDish = null;
      if ($editId > 0) {
          $st = $pdo->prepare('SELECT * FROM dishes WHERE id = ?');
          $st->execute([$editId]);
          $editDish = $st->fetch() ?: null;
      }
      $dishes = $pdo->query('SELECT * FROM dishes ORDER BY category_id ASC, sort_order ASC, id ASC')->fetchAll();
  ?>
    <h1 class="title">菜品</h1>
    <?php if (!$cats): ?>
      <div class="card"><div class="muted">请先到「分类」添加至少一个分类，再上传菜品。</div></div>
    <?php else: ?>
    <div class="card">
      <h2><span class="eyebrow"><?= $editDish ? '编辑' : '新增' ?></span> <?= $editDish ? '修改菜品' : '上传菜品' ?></h2>
      <form method="post" enctype="multipart/form-data">
        <input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
        <input type="hidden" name="action" value="<?= $editDish ? 'edit_dish' : 'add_dish' ?>">
        <?php if ($editDish): ?><input type="hidden" name="id" value="<?= (int) $editDish['id'] ?>"><?php endif; ?>
        <input type="hidden" name="image_url" value="<?= h($editDish['image_url'] ?? '') ?>">
        <div class="row">
          <div style="flex:2"><label>菜名</label><input type="text" name="name" value="<?= h($editDish['name'] ?? '') ?>" placeholder="如：番茄炒蛋"></div>
          <div><label>分类</label>
            <select name="category_id">
              <?php foreach ($cats as $c): ?>
                <option value="<?= (int) $c['id'] ?>" <?= ($editDish && (int) $editDish['category_id'] === (int) $c['id']) ? 'selected' : '' ?>><?= h($c['name']) ?></option>
              <?php endforeach; ?>
            </select>
          </div>
        </div>
        <div class="row">
          <div><label>价格（可留空填 0）</label><input type="number" step="0.01" name="price" value="<?= h((string) ($editDish['price'] ?? '0')) ?>"></div>
          <div><label>排序（小在前）</label><input type="number" name="sort_order" value="<?= h((string) ($editDish['sort_order'] ?? '0')) ?>"></div>
        </div>
        <div class="row">
          <div><label>辣度</label>
            <select name="spicy_level">
              <?php $spicyOpts = ['不辣', '微辣', '中辣', '重辣']; $curSpicy = (int) ($editDish['spicy_level'] ?? 0); ?>
              <?php foreach ($spicyOpts as $sv => $sl): ?>
                <option value="<?= $sv ?>" <?= $curSpicy === $sv ? 'selected' : '' ?>><?= h($sl) ?></option>
              <?php endforeach; ?>
            </select>
          </div>
          <div><label>分量（可选，如「约 2 人份 / 大份」）</label><input type="text" name="portion" value="<?= h($editDish['portion'] ?? '') ?>" placeholder="约 2 人份"></div>
          <div style="flex:0 0 auto;align-self:flex-end;padding-bottom:8px">
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" name="is_recommended" value="1" <?= !empty($editDish['is_recommended']) ? 'checked' : '' ?> style="width:auto">推荐
            </label>
          </div>
        </div>
        <div style="margin-bottom:14px"><label>描述（可选）</label><textarea name="description" placeholder="口味、做法、备注…"><?= h($editDish['description'] ?? '') ?></textarea></div>
        <div style="margin-bottom:16px">
          <label>菜品图片（可选，jpg/png/webp）</label>
          <input type="file" name="image" accept="image/*">
          <?php if (!empty($editDish['image_url'])): ?><div class="hint">当前已有图片，重新选择即可替换。</div><?php endif; ?>
        </div>
        <div class="actions">
          <button class="btn" type="submit"><?= $editDish ? '保存修改' : '上传菜品' ?></button>
          <?php if ($editDish): ?><a class="btn ghost" href="index.php?view=dishes">取消</a><?php endif; ?>
        </div>
      </form>
    </div>

    <div class="card">
      <h2><span class="eyebrow">列表</span> 全部菜品</h2>
      <table>
        <tr><th>图</th><th>菜名</th><th>分类</th><th>价格</th><th>状态</th><th style="text-align:right">操作</th></tr>
        <?php if (!$dishes): ?>
          <tr><td colspan="6" class="muted">还没有菜品，先在上面上传。</td></tr>
        <?php endif; ?>
        <?php foreach ($dishes as $d): ?>
          <tr>
            <td>
              <?php if (!empty($d['image_url'])): ?>
                <img class="thumb" src="<?= h($d['image_url']) ?>" alt="">
              <?php else: ?>
                <div class="thumb ph">无图</div>
              <?php endif; ?>
            </td>
            <td>
              <div class="serif" style="font-size:16px"><?= h($d['name']) ?></div>
              <?php
                $tags = [];
                if (!empty($d['is_recommended'])) { $tags[] = '推荐'; }
                $sl = (int) ($d['spicy_level'] ?? 0);
                if ($sl > 0) { $tags[] = ['', '微辣', '中辣', '重辣'][$sl]; }
                if (trim((string) ($d['portion'] ?? '')) !== '') { $tags[] = $d['portion']; }
              ?>
              <?php if ($tags): ?><div class="muted" style="font-size:12px;margin-top:2px"><?= h(implode(' · ', $tags)) ?></div><?php endif; ?>
              <?php if ($d['description'] !== ''): ?><div class="muted" style="font-size:12px"><?= h(mb_strimwidth($d['description'], 0, 40, '…')) ?></div><?php endif; ?>
            </td>
            <td class="muted"><?= h($catName[(int) $d['category_id']] ?? '—') ?></td>
            <td class="price"><?= $d['price'] > 0 ? '¥' . number_format((float) $d['price'], 0) : '—' ?></td>
            <td><span class="pill <?= $d['is_available'] ? 'on' : 'off' ?>"><?= $d['is_available'] ? '上架' : '下架' ?></span></td>
            <td style="text-align:right">
              <div class="actions" style="justify-content:flex-end">
                <a class="btn ghost sm" href="index.php?view=dishes&edit=<?= (int) $d['id'] ?>">编辑</a>
                <form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="toggle_dish"><input type="hidden" name="id" value="<?= (int) $d['id'] ?>"><button class="btn ghost sm" type="submit"><?= $d['is_available'] ? '下架' : '上架' ?></button></form>
                <form method="post" class="inline" onsubmit="return confirm('删除该菜品？')"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="action" value="del_dish"><input type="hidden" name="id" value="<?= (int) $d['id'] ?>"><button class="btn ghost sm" type="submit">删除</button></form>
              </div>
            </td>
          </tr>
        <?php endforeach; ?>
      </table>
    </div>
    <?php endif; ?>
  <?php elseif ($view === 'settings'): ?>
    <?php
      $cfgPath = dirname(__DIR__) . '/_private/config.php';
      $cfg = is_file($cfgPath) ? (require $cfgPath) : [];
      function mask_key(string $k): string {
        return $k === '' ? '（未配置）' : mb_substr($k, 0, 4) . str_repeat('*', max(4, mb_strlen($k) - 4));
      }
    ?>
    <div class="card">
      <h2><span class="eyebrow">系统</span> 接口配置</h2>
      <?php if ($flash): ?><div class="flash"><?= h($flash) ?></div><?php endif; ?>
      <form method="post" autocomplete="off">
        <input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
        <input type="hidden" name="action" value="save_settings">
        <table>
          <tr>
            <th>DeepSeek Key</th>
            <td>
              <div class="muted" style="font-size:12px;margin-bottom:6px">当前：<?= h(mask_key((string)($cfg['deepseek_key'] ?? ''))) ?></div>
              <input class="input" type="password" name="deepseek_key" placeholder="填写新 Key（留空保留原值）" style="width:320px">
            </td>
          </tr>
          <tr>
            <th>高德 Key</th>
            <td>
              <div class="muted" style="font-size:12px;margin-bottom:6px">当前：<?= h(mask_key((string)($cfg['amap_key'] ?? ''))) ?></div>
              <input class="input" type="password" name="amap_key" placeholder="填写新 Key（留空保留原值）" style="width:320px">
            </td>
          </tr>
          <tr>
            <th>小程序 AI 功能</th>
            <td>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
                <input type="checkbox" name="ai_enabled" value="1" <?= !empty($cfg['ai_enabled']) ? 'checked' : '' ?> style="width:18px;height:18px">
                <span>开启（关闭后小程序内所有 AI 入口自动隐藏，适合审核期间关闭）</span>
              </label>
            </td>
          </tr>
        </table>
        <div style="margin-top:16px"><button class="btn" type="submit">保存</button></div>
      </form>
    </div>
    <div class="card">
      <h2><span class="eyebrow">说明</span> 功能说明</h2>
      <table>
        <tr><th>功能</th><th>依赖</th><th>说明</th></tr>
        <tr><td>旅行手记生成</td><td>DeepSeek Key</td><td>照片 → 自动生成文字描述和标签</td></tr>
        <tr><td>精华筛选</td><td>DeepSeek Key</td><td>从所有照片里选出最佳时刻 / 最爱地点</td></tr>
        <tr><td>随手记打标</td><td>DeepSeek Key</td><td>上传随手拍后自动打情绪/场景标签</td></tr>
        <tr><td>地图 / 定位 / 路线 / 天气</td><td>高德 Key</td><td>地理编码、逆地理、路线规划、天气预报</td></tr>
      </table>
    </div>
  </div>
  <?php endif; ?>
<?php endif; ?>
</body>
</html>
