(function () {
  'use strict';

  var token = '';
  var queue = document.getElementById('gambitReviewQueue');
  var status = document.getElementById('gambitAdminStatus');

  function setStatus(message, kind) {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = kind || '';
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function request(path, options) {
    var init = options || {};
    init.headers = Object.assign({ Accept: 'application/json', Authorization: 'Bearer ' + token }, init.headers || {});
    return fetch(path, init).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) throw new Error(payload.message || payload.error || 'Request failed');
        return payload;
      });
    });
  }

  function renderArticle(article) {
    var draft = article || {};
    var evidence = (draft.evidence || []).map(function (item) {
      return '<li>' + escapeText(item.sourceTier || item.sourceId) + ' — ' + escapeText(item.title || item.canonicalUrl) + '</li>';
    }).join('');
    var trajectories = (draft.trajectories || []).map(function (trajectory) {
      return '<li>AI estimate · ~' + escapeText(trajectory.probability) + '% — ' + escapeText(trajectory.predictionStatement) + ' (' + escapeText(trajectory.deadline) + ')<br><small>Falsifier: ' + escapeText(trajectory.falsifier) + '</small></li>';
    }).join('');
    var provenance = Object.keys(draft.modelRoleProvenance || {}).map(function (role) {
      var value = draft.modelRoleProvenance[role] || {};
      return '<li>' + escapeText(role) + ': ' + escapeText(value.displayName || 'configured model') + ' · ' + escapeText(value.provider || 'unknown') + '</li>';
    }).join('');
    var critic = draft.critic || {};
    var card = document.createElement('article');
    card.className = 'gambit-review-card';
    card.dataset.revisionId = String(draft.currentRevisionId || draft.revisionId || '');
    card.innerHTML = '<h2>' + escapeText(draft.headline) + '</h2>'
      + '<p><span class="gambit-label">FACT</span> ' + escapeText(draft.surfaceEvent) + '</p>'
      + '<p><span class="gambit-label">ANALYSIS</span> ' + escapeText(draft.thesis) + '</p>'
      + '<p><strong>Countercase:</strong> ' + escapeText(draft.countercase) + '</p>'
      + '<p><strong>Critic:</strong> ' + escapeText(critic.accepted ? 'accepted' : 'rejected') + ' — ' + escapeText(critic.notes) + '</p>'
      + '<p><strong>Evidence / source quality:</strong></p><ul>' + evidence + '</ul>'
      + '<p><strong>AI forecasts / falsifiers:</strong></p><ul>' + trajectories + '</ul>'
      + '<p><strong>Model-role provenance:</strong></p><ul>' + provenance + '</ul>'
      + '<p><strong>Draft version:</strong> ' + escapeText(draft.draftVersion || 'unknown') + '</p>'
      + '<div class="gambit-review-actions"><button data-action="APPROVE">Approve and publish</button><button data-action="REJECT">Reject</button><button data-action="RETURN_FOR_REANALYSIS">Return for re-analysis</button></div>';
    card.querySelectorAll('button').forEach(function (button) {
      button.addEventListener('click', function () {
        var action = button.getAttribute('data-action');
        var revisionId = draft.currentRevisionId || draft.revisionId;
        if (!revisionId) return setStatus('This draft has no revision id.', 'error');
        var key = 'gambit-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        button.disabled = true;
        request('/api/open-gambit/review/' + encodeURIComponent(String(revisionId)), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify({ action: action, idempotencyKey: key })
        }).then(function () {
          setStatus('Review action completed.', 'ok');
          card.remove();
        }).catch(function (error) {
          button.disabled = false;
          setStatus(error.message, 'error');
        });
      });
    });
    return card;
  }

  function loadQueue() {
    if (!token || !queue) return;
    setStatus('Loading review queue…', 'loading');
    request('/api/open-gambit/review').then(function (payload) {
      queue.textContent = '';
      (payload.data || []).forEach(function (article) { queue.appendChild(renderArticle(article)); });
      setStatus((payload.data || []).length ? 'Drafts awaiting review.' : 'No drafts awaiting review.', 'ok');
    }).catch(function (error) {
      setStatus(error.message, 'error');
    });
  }

  token = window.prompt('Administrator token (not stored):') || '';
  if (!token) setStatus('An administrator token is required to load this console.', 'error');
  else loadQueue();
}());
