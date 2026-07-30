const express = require('express');
const router = express.Router();
const { authenticate } = require('../auth');

// Obtener estadísticas del usuario
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

    // Obtener posts populares del usuario
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

    // Obtener actividad reciente
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

// Obtener estadísticas de una publicación específica
router.get('/post/:postId/stats', authenticate, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const { rows } = await req.db.query(`
      SELECT 
        i.*,
        u.username as author,
        COUNT(DISTINCT l.id) as likes_count,
        COUNT(DISTINCT c.id) as comments_count,
        COUNT(DISTINCT v.id) as views_count,
        COUNT(DISTINCT r.id) as reports_count
      FROM items i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN likes l ON i.id = l.item_id
      LEFT JOIN comments c ON i.id = c.item_id
      LEFT JOIN views v ON i.id = v.item_id
      LEFT JOIN reports r ON i.id = r.item_id
      WHERE i.id = $1 AND i.user_id = $2 AND i.deleted = false
      GROUP BY i.id, u.username
    `, [postId, userId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Publicación no encontrada' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching post stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas de la publicación' });
  }
});

// Obtener tendencias globales
router.get('/trending', async (req, res) => {
  try {
    const { rows } = await req.db.query(`
      SELECT 
        i.id,
        i.title,
        i.description,
        i.image_url,
        i.likes,
        i.views,
        i.created_at,
        u.username,
        (i.likes * 0.6 + COALESCE(c.comment_count, 0) * 0.4) as trending_score
      FROM items i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN (
        SELECT item_id, COUNT(*) as comment_count
        FROM comments
        GROUP BY item_id
      ) c ON i.id = c.item_id
      WHERE i.expires_at > NOW() 
        AND i.deleted = false
        AND i.likes > 0
      ORDER BY trending_score DESC
      LIMIT 10
    `);

    res.json(rows);
  } catch (error) {
    console.error('Error fetching trending:', error);
    res.status(500).json({ error: 'Error al obtener tendencias' });
  }
});

module.exports = router;
