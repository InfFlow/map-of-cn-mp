<?php
declare(strict_types=1);

/**
 * Map of Us · 菜单后台
 * 单文件管理后台：登录 / 分类 / 菜品（含图片上传）/ 订单。
 * 依赖 _private/db.php 与 _private/config.php（含 admin_user / admin_pass_hash）。
 */

session_start();
require_once dirname(__DIR__, 2) . '/ql.hlat.xyz_private/db.php';
$config = require dirname(__DIR__, 2) . '/ql.hlat.xyz_private/config.php';

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
$view = $_GET['view'] ?? (is_logged_in() ? 'dishes' : 'login');
$flash = '';

/* ---------- 动作处理 ---------- */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();

    if ($action === 'login') {
        $u = trim((string) ($_POST['username'] ?? ''));
        $p = (string) ($_POST['password'] ?? '');
        if ($u === ($config['admin_user'] ?? '') && password_verify($p, $config['admin_pass_hash'] ?? '')) {
            $_SESSION['admin'] = $u;
            redirect('dishes');
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
                        'INSERT INTO dishes (category_id, name, description, price, image_url, sort_order)
                         VALUES (?, ?, ?, ?, ?, ?)'
                    );
                    $st->execute([$catId, $name, $desc, $price, $imageUrl, $sort]);
                } else {
                    $st = $pdo->prepare(
                        'UPDATE dishes SET category_id=?, name=?, description=?, price=?, image_url=?, sort_order=? WHERE id=?'
                    );
                    $st->execute([$catId, $name, $desc, $price, $imageUrl, $sort, $id]);
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
<title>Map of Us · 菜单后台</title>
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
  nav.tabs a.active{background:var(--ink);color:var(--bg);border-color:var(--ink)}
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
</style>
</head>
<body>

<?php if ($view === 'login'): ?>
  <div class="login-wrap">
    <div style="text-align:center;margin-bottom:26px">
      <div class="serif" style="font-weight:700;letter-spacing:1px;font-size:24px">Map of Us</div>
      <div class="eyebrow" style="margin-top:6px">菜单后台 · ADMIN</div>
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
      <div class="vol">菜单后台 · ADMIN</div>
    </div>
    <nav class="tabs">
      <a href="index.php?view=dishes" class="<?= $view === 'dishes' ? 'active' : '' ?>">菜品</a>
      <a href="index.php?view=categories" class="<?= $view === 'categories' ? 'active' : '' ?>">分类</a>
      <a href="index.php?view=orders" class="<?= $view === 'orders' ? 'active' : '' ?>">订单</a>
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

  if ($view === 'categories'):
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

  <?php else: // dishes
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
  <?php endif; ?>
  </div>
<?php endif; ?>
</body>
</html>
