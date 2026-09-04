/* ModelYard Community moderation console. The token intentionally lives in memory only. */
(function () {
  'use strict';

  var adminToken = '';
  var nextCursor = null;
  var currentStatus = 'all';
  var currentQuery = '';
  var currentTopic = '';
  var currentFeatured = false;
  var currentGithub = false;

  var authForm = document.getElementById('communityAdminAuthForm');
  var tokenInput = document.getElementById('communityAdminToken');
  var statusNode = document.getElementById('communityAdminStatus');
  var panel = document.getElementById('communityAdminPanel');
  var postList = document.getElementById('communityAdminPostList');
  var statusFilter = document.getElementById('communityAdminStatusFilter');
  var searchForm = document.getElementById('communityAdminSearchForm');
  var searchInput = document.getElementById('communityAdminSearch');
  var topicFilter = document.getElementById('communityAdminTopicFilter');
  var featuredFilter = document.getElementById('communityAdminFeaturedFilter');
  var githubFilter = document.getElementById('communityAdminGithubFilter');
  var announcementForm = document.getElementById('communityAdminAnnouncementForm');
  var announcementTopic = document.getElementById('communityAdminAnnouncementTopic');
  var announcementContent = document.getElementById('communityAdminAnnouncementContent');
  var announcementPin = document.getElementById('communityAdminAnnouncementPin');
  var announcementButton = document.getElementById('communityAdminAnnouncementButton');
  var announcementStatus = document.getElementById('communityAdminAnnouncementStatus');
  var statsGrid = document.getElementById('communityAdminStatsGrid');
  var refreshStatsButton = document.getElementById('communityAdminRefreshStats');
  var loadButton = document.getElementById('communityAdminLoadMore');
  var banForm = document.getElementById('communityBanForm');
  var banList = document.getElementById('communityBanList');

  function setStatus(message, kind) {
    if (!statusNode) return;
    statusNode.textContent = message || '';
    statusNode.className = 'community-form-status' + (kind ? ' ' + kind : '');
  }

  function apiError(payload, fallback) {
    return payload && typeof payload.message === 'string' ? payload.message : fallback;
  }

  function setAnnouncementStatus(message, kind) {
    if (!announcementStatus) return;
    announcementStatus.textContent = message || '';
    announcementStatus.className = 'community-form-status' + (kind ? ' ' + kind : '');
  }

  async function request(path, options) {
    var headers = Object.assign({ Accept: 'application/json', Authorization: 'Bearer ' + adminToken }, (options && options.headers) || {});
    var response = await fetch(path, Object.assign({}, options || {}, { headers: headers }));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(apiError(payload, 'The moderation request could not be completed.'));
    return payload;
  }

  function addText(parent, label, value) {
    var row = document.createElement('div');
    row.className = 'community-admin-field';
    var labelNode = document.createElement('strong');
    labelNode.textContent = label;
    row.appendChild(labelNode);
    var valueNode = document.createElement('pre');
    valueNode.textContent = value == null ? '' : String(value);
    row.appendChild(valueNode);
    parent.appendChild(row);
  }

  function renderStats(stats) {
    if (!statsGrid) return;
    statsGrid.textContent = '';
    var items = [
      ['Total', stats.total],
      ['Approved', stats.byStatus && stats.byStatus.approved],
      ['Pending', stats.byStatus && stats.byStatus.pending],
      ['Hidden', stats.byStatus && stats.byStatus.hidden],
      ['Deleted', stats.byStatus && stats.byStatus.deleted],
      ['Pinned', stats.pinned],
      ['Featured', stats.featured],
      ['Translation failed', stats.translationFailed],
      ['Embed failed', stats.embedFailed]
    ];
    items.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'community-admin-stat';
      var value = document.createElement('strong');
      value.textContent = String(Number(item[1]) || 0);
      var label = document.createElement('span');
      label.textContent = item[0];
      card.appendChild(value);
      card.appendChild(label);
      statsGrid.appendChild(card);
    });
  }

  function addAction(parent, label, action, postId, kind) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-btn community-admin-action' + (kind ? ' ' + kind : '');
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.postId = String(postId);
    button.addEventListener('click', function () { moderate(postId, action, button); });
    parent.appendChild(button);
  }

  function createPostCard(post) {
    var article = document.createElement('article');
    article.className = 'community-admin-post';
    var header = document.createElement('header');
    header.className = 'community-admin-post-header';
    var title = document.createElement('h3');
    title.textContent = (post.nickname || '') + ' · #' + String(post.id);
    header.appendChild(title);
    var status = document.createElement('span');
    status.className = 'community-admin-status ' + String(post.status || '');
    status.textContent = String(post.status || 'unknown');
    header.appendChild(status);
    article.appendChild(header);
    var badges = document.createElement('div');
    badges.className = 'community-post-badges';
    var topic = document.createElement('span');
    topic.className = 'community-topic-badge';
    topic.textContent = String(post.topic || 'general');
    badges.appendChild(topic);
    if (post.isPinned) {
      var pinned = document.createElement('span');
      pinned.className = 'community-post-badge pinned';
      pinned.textContent = 'Pinned';
      badges.appendChild(pinned);
    }
    if (post.isFeatured) {
      var featured = document.createElement('span');
      featured.className = 'community-post-badge featured';
      featured.textContent = 'Featured';
      badges.appendChild(featured);
    }
    if (post.isAnnouncement) {
      var announcement = document.createElement('span');
      announcement.className = 'community-post-badge announcement';
      announcement.textContent = 'Announcement';
      badges.appendChild(announcement);
    }
    article.appendChild(badges);
    addText(article, 'Created', post.createdAt);
    addText(article, 'Topic', post.topic || 'general');
    addText(article, 'Original (' + String(post.originalLanguage || 'und') + ')', post.originalContent);
    if (post.contentEn) addText(article, 'English', post.contentEn);
    if (post.contentZh) addText(article, 'Chinese', post.contentZh);
    addText(article, 'Translation', String(post.translationStatus || 'pending') + (post.translationProvider ? ' · ' + post.translationProvider : ''));
    if (post.moderationReason) addText(article, 'Moderation reason', post.moderationReason);
    var source = document.createElement('p');
    source.className = 'community-admin-source-hash';
    source.textContent = 'Source hash: ' + String(post.sourceHash || '');
    article.appendChild(source);
    var actions = document.createElement('div');
    actions.className = 'community-admin-actions';
    if (post.status === 'deleted') {
      addAction(actions, 'Restore', 'restore', post.id);
    } else {
      if (post.status !== 'approved') addAction(actions, 'Approve', 'approve', post.id);
      if (post.status !== 'hidden') addAction(actions, 'Hide', 'hide', post.id);
      if (post.status === 'hidden') addAction(actions, 'Unhide', 'unhide', post.id);
      addAction(actions, 'Delete', 'delete', post.id, 'danger');
      addAction(actions, post.isPinned ? 'Unpin' : 'Pin', post.isPinned ? 'unpin' : 'pin', post.id);
      addAction(actions, post.isFeatured ? 'Unfeature' : 'Feature', post.isFeatured ? 'unfeature' : 'feature', post.id);
    }
    addAction(actions, 'Ban source', 'ban-source', post.id, 'danger');
    addAction(actions, 'Retry translation', 'retry-translation', post.id);
    addAction(actions, 'Retry GitHub metadata', 'retry-embed', post.id);
    article.appendChild(actions);
    return article;
  }

  async function moderate(postId, action, button) {
    if (action === 'restore' && !window.confirm('Restore this deleted post?')) return;
    if (button) button.disabled = true;
    setStatus('Saving moderation decision…', 'loading');
    try {
      if (action === 'retry-translation' || action === 'retry-embed') {
        await request('/api/admin/community/posts/' + encodeURIComponent(String(postId)) + '/' + action, { method: 'POST' });
      } else {
        await request('/api/admin/community/posts/' + encodeURIComponent(String(postId)), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: action })
        });
      }
      setStatus('Saved.', 'success');
      await loadPosts(false);
      await Promise.all([loadStats(), loadBans()]);
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Unable to save the decision.', 'error');
      if (button) button.disabled = false;
    }
  }

  async function loadPosts(append) {
    if (!adminToken || !postList) return false;
    var query = new URL('/api/admin/community/posts', window.location.origin);
    query.searchParams.set('limit', '20');
    if (currentStatus !== 'all') query.searchParams.set('status', currentStatus);
    if (currentQuery) query.searchParams.set('q', currentQuery);
    if (currentTopic) query.searchParams.set('topic', currentTopic);
    if (currentFeatured) query.searchParams.set('featured', '1');
    if (currentGithub) query.searchParams.set('github', '1');
    if (append && nextCursor) query.searchParams.set('cursor', nextCursor);
    if (!append) {
      postList.textContent = '';
      nextCursor = null;
    }
    if (loadButton) loadButton.disabled = true;
    try {
      var payload = await request(query.pathname + query.search, { method: 'GET' });
      if (!append) postList.textContent = '';
      if (!Array.isArray(payload.data) || payload.data.length === 0) {
        if (!append) {
          var empty = document.createElement('p');
          empty.className = 'community-empty';
          empty.textContent = 'No posts in this view.';
          postList.appendChild(empty);
        }
      } else {
        payload.data.forEach(function (post) { postList.appendChild(createPostCard(post)); });
      }
      nextCursor = payload.nextCursor || null;
      if (loadButton) {
        loadButton.hidden = !nextCursor;
        loadButton.disabled = false;
      }
      setStatus('Loaded ' + String(payload.total || 0) + ' post(s).', 'success');
      return true;
    } catch (error) {
      if (loadButton) loadButton.disabled = false;
      setStatus(error && error.message ? error.message : 'Unable to load moderation data.', 'error');
      return false;
    }
  }

  function createBanRow(ban) {
    var row = document.createElement('div');
    row.className = 'community-ban-row';
    var text = document.createElement('span');
    text.textContent = String(ban.sourceHash || '') + (ban.reason ? ' · ' + String(ban.reason) : '') + (ban.expiresAt ? ' · expires ' + String(ban.expiresAt) : ' · permanent');
    row.appendChild(text);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-btn';
    button.textContent = 'Unblock';
    button.disabled = !ban.active;
    button.addEventListener('click', async function () {
      button.disabled = true;
      try {
        await request('/api/admin/community/bans/' + encodeURIComponent(String(ban.sourceHash)), { method: 'DELETE' });
        setStatus('Source unblocked.', 'success');
        await loadBans();
      } catch (error) {
        setStatus(error && error.message ? error.message : 'Unable to unblock this source.', 'error');
        button.disabled = false;
      }
    });
    row.appendChild(button);
    return row;
  }

  async function loadStats() {
    if (!adminToken || !statsGrid) return;
    try {
      var payload = await request('/api/admin/community/stats', { method: 'GET' });
      renderStats(payload.data || {});
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Unable to load community statistics.', 'error');
    }
  }

  async function loadBans() {
    if (!adminToken || !banList) return;
    try {
      var payload = await request('/api/admin/community/bans?all=1', { method: 'GET' });
      banList.textContent = '';
      if (!Array.isArray(payload.data) || payload.data.length === 0) {
        var empty = document.createElement('p');
        empty.className = 'community-form-hint';
        empty.textContent = 'No source blocks.';
        banList.appendChild(empty);
      } else {
        payload.data.forEach(function (ban) { banList.appendChild(createBanRow(ban)); });
      }
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Unable to load source blocks.', 'error');
    }
  }

  async function publishAnnouncement(event) {
    event.preventDefault();
    if (!announcementContent || !announcementTopic || !announcementButton) return;
    var content = announcementContent.value.normalize('NFC').trim();
    if (!content) return setAnnouncementStatus('Enter an announcement.', 'error');
    if (Array.from(content).length > 2000) return setAnnouncementStatus('Announcement is too long.', 'error');
    announcementButton.disabled = true;
    setAnnouncementStatus('Publishing…', 'loading');
    try {
      var payload = await request('/api/admin/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content,
          topic: announcementTopic.value || 'general',
          pin: Boolean(announcementPin && announcementPin.checked)
        })
      });
      if (announcementContent) announcementContent.value = '';
      if (announcementPin) announcementPin.checked = false;
      setAnnouncementStatus(apiError(payload, 'Announcement published.'), 'success');
      await loadPosts(false);
      await loadStats();
    } catch (error) {
      setAnnouncementStatus(error && error.message ? error.message : 'Unable to publish the announcement right now.', 'error');
    } finally {
      announcementButton.disabled = false;
    }
  }

  async function authenticate(event) {
    event.preventDefault();
    var value = tokenInput && tokenInput.value ? tokenInput.value.trim() : '';
    if (!value) return setStatus('Enter the administrator token.', 'error');
    adminToken = value;
    if (tokenInput) tokenInput.value = '';
    setStatus('Checking administrator access…', 'loading');
    var authenticated = await loadPosts(false);
    if (!authenticated) {
      adminToken = '';
      return;
    }
    if (panel) panel.hidden = false;
    await Promise.all([loadStats(), loadBans()]);
  }

  if (authForm) authForm.addEventListener('submit', authenticate);
  if (announcementForm) announcementForm.addEventListener('submit', publishAnnouncement);
  if (statusFilter) statusFilter.addEventListener('change', function () {
    currentStatus = statusFilter.value || 'all';
    loadPosts(false);
  });
  if (searchForm) searchForm.addEventListener('submit', function (event) {
    event.preventDefault();
    currentQuery = searchInput && searchInput.value ? searchInput.value.normalize('NFC').trim().slice(0, 80) : '';
    currentTopic = topicFilter ? topicFilter.value : '';
    currentFeatured = Boolean(featuredFilter && featuredFilter.checked);
    currentGithub = Boolean(githubFilter && githubFilter.checked);
    loadPosts(false);
  });
  if (loadButton) loadButton.addEventListener('click', function () { loadPosts(true); });
  if (refreshStatsButton) refreshStatsButton.addEventListener('click', function () { loadStats(); });
  if (banForm) banForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    var hashInput = document.getElementById('communityBanHash');
    var reasonInput = document.getElementById('communityBanReason');
    var expiryInput = document.getElementById('communityBanExpiry');
    var sourceHash = hashInput ? hashInput.value.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) return setStatus('Enter a valid 64-character source hash.', 'error');
    var expiresAt = null;
    if (expiryInput && expiryInput.value) {
      var expiryDate = new Date(expiryInput.value);
      if (Number.isNaN(expiryDate.getTime())) return setStatus('Enter a valid expiry date.', 'error');
      expiresAt = expiryDate.toISOString();
    }
    try {
      await request('/api/admin/community/bans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceHash: sourceHash, reason: reasonInput ? reasonInput.value : '', expiresAt: expiresAt })
      });
      if (hashInput) hashInput.value = '';
      if (reasonInput) reasonInput.value = '';
      if (expiryInput) expiryInput.value = '';
      setStatus('Source blocked.', 'success');
      await loadBans();
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Unable to block this source.', 'error');
    }
  });
}());
