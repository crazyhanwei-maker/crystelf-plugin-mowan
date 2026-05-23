(function () {
  function createMediaHandlers(deps = {}) {
    const {
      state,
      $,
      MAX_IMAGE_ATTACHMENTS,
      MAX_IMAGE_BYTES,
      MAX_VOICE_BYTES,
      formatBytes,
      estimateDataUrlSize,
      fileToDataUrl,
      updateStatus,
      updateSummary,
    } = deps;

    function renderAttachmentPreview() {
      const imageBox = $('qq-simulator-image-preview');
      if (state.screenshots.length === 0) {
        imageBox.textContent = '暂无本地截图';
      } else {
        const nodes = state.screenshots.map(item => {
          const card = document.createElement('div');
          card.className = 'qq-simulator-attachment-card';
          const img = document.createElement('img');
          img.className = 'qq-simulator-preview-image';
          img.src = item.dataUrl;
          img.alt = item.name;
          const meta = document.createElement('div');
          meta.textContent = `${item.name} / ${formatBytes(item.sizeBytes)}`;
          card.append(img, meta);
          return card;
        });
        imageBox.replaceChildren(...nodes);
      }

      const voiceBox = $('qq-simulator-voice-preview');
      if (!state.voice) {
        voiceBox.textContent = '暂无语音';
      } else {
        const card = document.createElement('div');
        card.className = 'qq-simulator-attachment-card';
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = state.voice.dataUrl;
        const meta = document.createElement('div');
        meta.textContent = `${state.voice.name} / ${formatBytes(state.voice.sizeBytes)}`;
        card.append(audio, meta);
        voiceBox.replaceChildren(card);
      }
      updateSummary();
    }

    function clearAttachments() {
      state.screenshots = [];
      state.voice = null;
      $('qq-simulator-voice-transcript').value = '';
      renderAttachmentPreview();
    }

    async function addImageFiles(files) {
      const selected = Array.from(files || []).filter(file => file && /^image\//i.test(file.type || ''));
      if (selected.length === 0) return;
      const availableSlots = MAX_IMAGE_ATTACHMENTS - state.screenshots.length;
      if (availableSlots <= 0) {
        updateStatus(`最多同时附加 ${MAX_IMAGE_ATTACHMENTS} 张本地截图。`, 'error');
        return;
      }
      const accepted = selected.slice(0, availableSlots);
      const skipped = selected.length - accepted.length;
      const nextItems = [];
      for (const file of accepted) {
        if (file.size > MAX_IMAGE_BYTES) {
          updateStatus(`${file.name} 超过 ${formatBytes(MAX_IMAGE_BYTES)}，已跳过。`, 'error');
          continue;
        }
        const dataUrl = await fileToDataUrl(file);
        nextItems.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name: file.name || `image-${Date.now()}`,
          mimeType: file.type || 'image/*',
          sizeBytes: file.size || estimateDataUrlSize(dataUrl),
          dataUrl,
        });
      }
      state.screenshots.push(...nextItems);
      renderAttachmentPreview();
      if (nextItems.length > 0) {
        updateStatus(skipped > 0 ? `已添加 ${nextItems.length} 张图片，另有 ${skipped} 张超过数量限制。` : `已添加 ${nextItems.length} 张图片。`, 'success');
      }
    }

    async function captureScreenshot() {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        updateStatus('当前浏览器不支持屏幕截取。', 'error');
        return;
      }
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        await new Promise(resolve => requestAnimationFrame(resolve));

        const width = video.videoWidth || 1280;
        const height = video.videoHeight || 720;
        const scale = Math.min(1, 1280 / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        const sizeBytes = estimateDataUrlSize(dataUrl);
        if (sizeBytes > MAX_IMAGE_BYTES) {
          updateStatus(`截屏超过 ${formatBytes(MAX_IMAGE_BYTES)}，请改用较小截图文件。`, 'error');
          return;
        }
        state.screenshots.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name: `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes,
          dataUrl,
        });
        state.screenshots = state.screenshots.slice(-MAX_IMAGE_ATTACHMENTS);
        renderAttachmentPreview();
        updateStatus('已添加屏幕截图。', 'success');
      } catch (error) {
        updateStatus(error?.message || '截屏失败。', 'error');
      } finally {
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
      }
    }

    async function addVoiceFile(file) {
      if (!file) return;
      if (!/^audio\//i.test(file.type || '')) {
        updateStatus('请选择音频文件。', 'error');
        return;
      }
      if (file.size > MAX_VOICE_BYTES) {
        updateStatus(`语音超过 ${formatBytes(MAX_VOICE_BYTES)}，已跳过。`, 'error');
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      state.voice = {
        name: file.name || `voice-${Date.now()}`,
        mimeType: file.type || 'audio/*',
        sizeBytes: file.size || estimateDataUrlSize(dataUrl),
        durationSeconds: 0,
        dataUrl,
      };
      renderAttachmentPreview();
      updateStatus('已添加语音。', 'success');
    }

    return {
      clearAttachments,
      renderAttachmentPreview,
      addImageFiles,
      captureScreenshot,
      addVoiceFile,
    };
  }

  window.CrystelfQqSimulatorMedia = {
    createMediaHandlers,
  };
})();
