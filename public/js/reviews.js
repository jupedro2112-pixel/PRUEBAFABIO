/**
 * VIP.reviews — sistema de opiniones del usuario.
 *
 * Card arriba: 5 estrellas + textarea max 100 chars + boton enviar.
 * Bloque al fondo: promedio de la casa + porcentajes bueno/regular/malo
 * + lista chica encuadrada con username enmascarado al 80%.
 */
window.VIP = window.VIP || {};
VIP.reviews = (function () {
    'use strict';

    let _selectedStars = 0;
    let _myReviewLoaded = false;
    let _feedPollId = null;

    function _q(id) { return document.getElementById(id); }

    // ---------- Card del form (arriba del user line) ----------
    function _paintStarsRow(value) {
        const stars = document.querySelectorAll('#reviewStarsRow .review-star');
        stars.forEach(st => {
            const v = Number(st.getAttribute('data-v'));
            st.classList.toggle('active', v <= value);
            st.classList.remove('hover');
        });
    }
    function _hoverStarsRow(value) {
        const stars = document.querySelectorAll('#reviewStarsRow .review-star');
        stars.forEach(st => {
            const v = Number(st.getAttribute('data-v'));
            st.classList.toggle('hover', v <= value);
        });
    }

    function _wireFormOnce() {
        if (_wireFormOnce._wired) return;
        _wireFormOnce._wired = true;

        const stars = document.querySelectorAll('#reviewStarsRow .review-star');
        stars.forEach(st => {
            st.addEventListener('click', () => {
                _selectedStars = Number(st.getAttribute('data-v'));
                _paintStarsRow(_selectedStars);
            });
            st.addEventListener('mouseenter', () => {
                _hoverStarsRow(Number(st.getAttribute('data-v')));
            });
            st.addEventListener('mouseleave', () => {
                _hoverStarsRow(0);
                _paintStarsRow(_selectedStars);
            });
        });

        const ta = _q('reviewCommentInput');
        const cnt = _q('reviewCharCount');
        if (ta && cnt) {
            ta.addEventListener('input', () => {
                cnt.textContent = String(ta.value.length);
            });
        }

        const btn = _q('reviewSubmitBtn');
        if (btn) btn.addEventListener('click', submitReview);
    }

    async function loadMyReview() {
        if (!VIP.state || !VIP.state.currentToken) return;
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/reviews/mine`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (!r.ok) return;
            const data = await r.json();
            if (data && data.review) {
                _selectedStars = Number(data.review.stars) || 0;
                _paintStarsRow(_selectedStars);
                const ta = _q('reviewCommentInput');
                if (ta) {
                    ta.value = data.review.comment || '';
                    const cnt = _q('reviewCharCount');
                    if (cnt) cnt.textContent = String(ta.value.length);
                }
                const btn = _q('reviewSubmitBtn');
                if (btn) btn.textContent = '✏️ Actualizar mi opinión';
            }
            _myReviewLoaded = true;
        } catch (_) { /* ignore */ }
    }

    async function submitReview() {
        const msg = _q('reviewSubmitMsg');
        const btn = _q('reviewSubmitBtn');
        if (!_selectedStars || _selectedStars < 1 || _selectedStars > 5) {
            if (msg) { msg.style.color = '#ff8080'; msg.textContent = '⚠️ Elegí cuántas estrellas darnos.'; }
            return;
        }
        const ta = _q('reviewCommentInput');
        const comment = ((ta && ta.value) || '').trim().slice(0, 100);
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }
        if (msg) { msg.style.color = '#aaa'; msg.textContent = '⏳ Enviando…'; }
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/reviews`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VIP.state.currentToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ stars: _selectedStars, comment })
            });
            const data = await r.json();
            if (!r.ok) {
                if (msg) { msg.style.color = '#ff8080'; msg.textContent = '❌ ' + (data.error || 'Error'); }
                if (btn) { btn.disabled = false; btn.textContent = '📨 Enviar opinión'; }
                return;
            }
            if (msg) { msg.style.color = '#66ff66'; msg.textContent = '✅ ¡Gracias! Tu opinión nos ayuda a mejorar.'; }
            if (btn) { btn.disabled = false; btn.textContent = '✏️ Actualizar mi opinión'; }
            // Refrescar el feed para que aparezca/actualice nuestra opinion abajo.
            loadFeed();
        } catch (e) {
            if (msg) { msg.style.color = '#ff8080'; msg.textContent = '❌ Error de conexión'; }
            if (btn) { btn.disabled = false; btn.textContent = '📨 Enviar opinión'; }
        }
    }

    // ---------- Feed (al fondo) ----------
    function _renderStars(n) {
        const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
        let html = '';
        for (let i = 1; i <= 5; i++) {
            html += i <= v ? '★' : '<span class="empty">★</span>';
        }
        return html;
    }
    function _renderAvgStars(avg) {
        const a = Math.max(0, Math.min(5, Number(avg) || 0));
        const full = Math.floor(a);
        let html = '';
        for (let i = 1; i <= 5; i++) {
            if (i <= full) html += '<span class="filled">★</span>';
            else html += '<span class="empty">★</span>';
        }
        return html;
    }
    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _whenStr(d) {
        if (!d) return '';
        try {
            const dt = new Date(d);
            return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
        } catch (_) { return ''; }
    }

    async function loadFeed() {
        if (!VIP.state || !VIP.state.currentToken) return;
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/reviews/feed?limit=30`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (!r.ok) return;
            const data = await r.json();
            _renderFeed(data);
        } catch (_) { /* ignore */ }
    }

    function _renderFeed(data) {
        const summary = _q('reviewsFeedSummary');
        const list = _q('reviewsFeedList');
        const card = _q('reviewsFeedCard');
        if (!summary || !list || !card) return;

        const total = Number(data.total || 0);
        if (total === 0) {
            summary.innerHTML =
                '<div style="color:#aaa;font-size:12px;line-height:1.5;">Todavía no hay opiniones. Sé el primero arriba ☝</div>';
            list.innerHTML = '';
            return;
        }
        const avg = Number(data.avgStars || 0);
        const counts = data.counts || {};
        const bueno = Number(counts.bueno || 0);
        const regular = Number(counts.regular || 0);
        const malo = Number(counts.malo || 0);
        const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(0) + '%' : '0%';

        summary.innerHTML =
            '<div class="avg-stars">' + _renderAvgStars(avg) + '</div>' +
            '<div class="avg-num">' + avg.toFixed(1) + ' / 5 · ' + total + ' opinion' + (total === 1 ? '' : 'es') + '</div>' +
            '<div class="pct-row">' +
                '<span class="pct-good">😊 ' + pct(bueno) + ' BUENO</span>' +
                '<span class="pct-reg">😐 ' + pct(regular) + ' REGULAR</span>' +
                '<span class="pct-bad">😟 ' + pct(malo) + ' MALO</span>' +
            '</div>';

        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length === 0) {
            list.innerHTML = '<div style="color:#aaa;font-size:11.5px;text-align:center;padding:6px;">Sin comentarios públicos.</div>';
            return;
        }
        let html = '';
        for (const it of items) {
            const stars = _renderStars(it.stars);
            const comment = it.comment ? _esc(it.comment) : '<span style="color:#888;font-style:italic;">(sin comentario)</span>';
            const when = _whenStr(it.updatedAt);
            html += '<div class="review-item">';
            html += '  <div class="item-stars">' + stars + '</div>';
            html += '  <div class="item-body">';
            html += '    <div class="item-comment">' + comment + '</div>';
            html += '    <div class="item-meta">' + _esc(it.maskedUsername || '***') + (when ? ' · ' + when : '') + '</div>';
            html += '  </div>';
            html += '</div>';
        }
        list.innerHTML = html;
    }

    function init() {
        _wireFormOnce();
        loadMyReview();
        loadFeed();
        // Refresco cada 90s para ver opiniones nuevas sin recargar.
        if (_feedPollId) clearInterval(_feedPollId);
        _feedPollId = setInterval(() => {
            if (document.visibilityState === 'visible') loadFeed();
        }, 90000);
    }

    return { init, loadMyReview, loadFeed, submitReview };
})();
