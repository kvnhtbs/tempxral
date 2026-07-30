const express = require('express');
const router = express.Router();
const { authenticate } = require('./auth');

// ========== ESTADÍSTICAS DEL USUARIO ==========
router.get('/user/stats', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await req.db.query(`
      WITH user_posts AS (
        SELECT 
          id,
          created_at,
          expires_at,
          likes,
          views,
          CASE 
            WHEN expires_at < NOW() THEN true 
            ELSE false 
          END as is_expired
        FROM items 
        WHERE user_id = $1 AND deleted = false
      ),
      post_stats AS (
        SELECT 
          COUNT(*) as total_posts,
          COUNT(CASE WHEN is_expired THEN 1 END) as expired_posts,
          COUNT(CASE WHEN NOT is_expired THEN 1 END) as active_posts,
          COALESCE(SUM(likes), 0) as total_likes,
          COALESCE(SUM(views), 0) as total_views,
          COALESCE(AVG(EXTRACT(EPOCH FROM (expires_at - created_at))), 0) as avg_lifetime_seconds,
          COALESCE(MAX(EXTRACT(EPOCH FROM (expires_at - created_at))), 0) as max_lifetime_seconds,
          COALESCE(MIN(EXTRACT(EPOCH FROM (expires_at - created_at))), 0) as min_lifetime_seconds
        FROM user_posts
      ),
      interaction_stats AS (
        SELECT 
          COUNT(DISTINCT item_id) as items_interacted,
          COUNT(*) as total_interactions
        FROM likes
        WHERE user_id = $1
      )
      SELECT 
        ps.*,
        COALESCE(is_.items_interacted, 0) as items_interacted,
        COALESCE(is_.total_interactions, 0) as total_interactions,
        (
          SELECT COUNT(*) 
          FROM comments 
          WHERE user_id = $1
        ) as total_comments,
        (
          SELECT COUNT(*) 
          FROM items 
          WHERE user_id = $1 
          AND created_at > NOW() - INTERVAL '7 days'
        ) as posts_last_7_days
      FROM post_stats ps
      LEFT JOIN interaction_stats is_ ON true
    `, [userId]);

    const stats = rows[0] || {
      total_posts: 0,
      expired_posts: 0,
      active_posts: 0,
      total_likes: 0,
      total_views: 0,
      avg_lifetime_seconds: 0,
      max_lifetime_seconds: 0,
      min_lifetime_seconds: 0,
      items_interacted: 0,
      total_interactions: 0,
      total_comments: 0,
      posts_last_7_days: 0
    };

    const popularPosts = await req.db.query(`
      SELECT 
        id,
        title,
        description,
        likes,
        views,
        created_at,
        expires_at,
        (likes * 0.7 + views * 0.3) as engagement_score
      FROM items
      WHERE user_id = $1 AND deleted = false
      ORDER BY engagement_score DESC
      LIMIT 5
    `, [userId]);

    const recentActivity = await req.db.query(`
      SELECT 
        action,
        item_id,
        details,
        created_at
      FROM user_activity
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId]);

    res.json({
      stats: {
        ...stats,
        avg_lifetime_hours: stats.avg_lifetime_seconds / 3600,
        max_lifetime_hours: stats.max_lifetime_seconds / 3600,
        min_lifetime_hours: stats.min_lifetime_seconds / 3600
      },
      popular_posts: popularPosts.rows,
      recent_activity: recentActivity.rows,
      engagement_rate: stats.total_posts > 0 
        ? ((stats.total_likes + stats.total_comments) / stats.total_posts).toFixed(2)
        : 0
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ========== NOTIFICACIONES ==========
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await req.db.query(`
      SELECT id, message, type, action, post_id, actor_username, read, created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);

    // Marcar como leídas
    await req.db.query(`
      UPDATE notifications 
      SET read = true, updated_at = NOW()
      WHERE user_id = $1 AND read = false
    `, [userId]);

    res.json({ notifications: rows });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Error al obtener notificaciones' });
  }
});

module.exports = router;
