// DOM Elements
const videoUrlInput = document.getElementById('videoUrl');
const analyzeBtn = document.getElementById('analyzeBtn');
const platformsGrid = document.getElementById('platformsGrid');
const infoSection = document.getElementById('infoSection');
const progressSection = document.getElementById('progressSection');
const videoThumb = document.getElementById('videoThumb');
const videoTitle = document.getElementById('videoTitle');
const videoAuthor = document.getElementById('videoAuthor');
const videoDuration = document.getElementById('videoDuration');
const videoPlatform = document.getElementById('videoPlatform');
const formatsGrid = document.getElementById('formatsGrid');
const downloadBtn = document.getElementById('downloadBtn');
const cancelBtn = document.getElementById('cancelBtn');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const progressPercentage = document.getElementById('progressPercentage');
const progressActions = document.getElementById('progressActions');
const downloadLink = document.getElementById('downloadLink');
const newDownloadBtn = document.getElementById('newDownloadBtn');
const loadingModal = document.getElementById('loadingModal');
const loadingText = document.getElementById('loadingText');

// State
let currentTaskId = null;
let currentVideoInfo = null;
let selectedFormat = 'best';
let checkInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSupportedPlatforms();
    setupEventListeners();
    loadRecentUrls();
});

// Load supported platforms
async function loadSupportedPlatforms() {
    try {
        const response = await fetch('/api/supported');
        const data = await response.json();
        
        platformsGrid.innerHTML = '';
        data.platforms.forEach(platform => {
            const card = createPlatformCard(platform);
            platformsGrid.appendChild(card);
        });
    } catch (error) {
        console.error('Error loading platforms:', error);
    }
}

// Create platform card
function createPlatformCard(platform) {
    const card = document.createElement('div');
    card.className = 'platform-card';
    
    // Set gradient colors
    const color1 = platform.colors[0];
    const color2 = platform.colors[1] || platform.colors[0];
    card.style.setProperty('--color1', color1);
    card.style.setProperty('--color2', color2);
    
    card.innerHTML = `
        <div class="platform-icon">
            <i class="fab fa-${platform.icon}"></i>
        </div>
        <h3>${platform.name}</h3>
        <div class="platform-formats">
            ${platform.formats.join('<br>')}
        </div>
    `;
    
    card.addEventListener('click', () => {
        videoUrlInput.placeholder = `Paste ${platform.name} video URL here...`;
        videoUrlInput.focus();
    });
    
    return card;
}

// Setup event listeners
function setupEventListeners() {
    analyzeBtn.addEventListener('click', analyzeUrl);
    videoUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') analyzeUrl();
    });
    
    cancelBtn.addEventListener('click', resetUI);
    newDownloadBtn.addEventListener('click', resetUI);
    
    downloadBtn.addEventListener('click', startDownload);
    
    // URL input suggestions
    videoUrlInput.addEventListener('input', function() {
        const url = this.value;
        if (url.length > 10) {
            detectPlatformFromUrl(url);
        }
    });
}

// Detect platform from URL
async function detectPlatformFromUrl(url) {
    try {
        const response = await fetch('/api/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        
        const data = await response.json();
        if (data.platform && data.platform !== 'unknown') {
            videoUrlInput.style.borderColor = '#4CAF50';
        }
    } catch (error) {
        console.error('Detection error:', error);
    }
}

// Analyze URL
async function analyzeUrl() {
    const url = videoUrlInput.value.trim();
    
    if (!url) {
        showError('Please enter a video URL');
        return;
    }
    
    if (!isValidUrl(url)) {
        showError('Please enter a valid URL');
        return;
    }
    
    showLoading('Analyzing video URL...');
    
    try {
        // First detect platform
        const detectResponse = await fetch('/api/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        
        const detectData = await detectResponse.json();
        
        // Get video info
        const infoResponse = await fetch('/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        
        if (!infoResponse.ok) {
            throw new Error('Failed to get video information');
        }
        
        const videoInfo = await infoResponse.json();
        currentVideoInfo = videoInfo;
        
        // Update UI with video info
        updateVideoInfo(videoInfo, detectData.platform);
        
        // Show info section
        infoSection.classList.remove('hidden');
        progressSection.classList.add('hidden');
        
        // Scroll to info section
        infoSection.scrollIntoView({ behavior: 'smooth' });
        
    } catch (error) {
        showError(`Error: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Update video info in UI
function updateVideoInfo(info, platform) {
    videoTitle.textContent = info.title || 'Unknown Title';
    videoAuthor.textContent = info.uploader || 'Unknown Author';
    videoDuration.textContent = formatDuration(info.duration || 0);
    videoPlatform.textContent = platform.charAt(0).toUpperCase() + platform.slice(1);
    
    if (info.thumbnail) {
        videoThumb.src = info.thumbnail;
        videoThumb.onerror = () => {
            videoThumb.src = 'https://via.placeholder.com/300x200/667eea/ffffff?text=No+Thumbnail';
        };
    } else {
        videoThumb.src = 'https://via.placeholder.com/300x200/667eea/ffffff?text=No+Thumbnail';
    }
    
    // Load formats
    loadFormats(info.formats || []);
}

// Load available formats
function loadFormats(formats) {
    formatsGrid.innerHTML = '';
    selectedFormat = 'best';
    
    // Always include best quality option
    const bestOption = createFormatOption('best', 'Best Quality', 'MP4', 'Auto');
    bestOption.classList.add('active');
    formatsGrid.appendChild(bestOption);
    
    // Add audio only option
    const audioOption = createFormatOption('bestaudio', 'Audio Only', 'MP3', '128kbps');
    formatsGrid.appendChild(audioOption);
    
    // Add other formats if available
    if (formats.length > 0) {
        formats.slice(0, 6).forEach(format => {
            const option = createFormatOption(
                format.format_id,
                `${format.resolution || format.format_note}`,
                format.ext.toUpperCase(),
                format.filesize ? formatFileSize(format.filesize) : 'Unknown'
            );
            formatsGrid.appendChild(option);
        });
    }
    
    // Add format selection handlers
    document.querySelectorAll('.format-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            selectedFormat = this.dataset.formatId;
            downloadBtn.disabled = false;
        });
    });
    
    downloadBtn.disabled = false;
}

// Create format option element
function createFormatOption(formatId, name, type, size) {
    const div = document.createElement('div');
    div.className = 'format-btn';
    div.dataset.formatId = formatId;
    div.innerHTML = `
        <div class="format-name">${name}</div>
        <div class="format-type">${type}</div>
        <div class="format-size">${size}</div>
    `;
    return div;
}

// Start download
async function startDownload() {
    if (!currentVideoInfo || !videoUrlInput.value) {
        showError('No video selected');
        return;
    }
    
    showLoading('Starting download...');
    
    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: videoUrlInput.value,
                format: selectedFormat
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Download failed');
        }
        
        currentTaskId = data.task_id;
        
        // Switch to progress view
        infoSection.classList.add('hidden');
        progressSection.classList.remove('hidden');
        progressSection.scrollIntoView({ behavior: 'smooth' });
        
        // Start checking progress
        checkDownloadProgress();
        
    } catch (error) {
        showError(`Download error: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Check download progress
async function checkDownloadProgress() {
    if (!currentTaskId) return;
    
    if (checkInterval) clearInterval(checkInterval);
    
    checkInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/status/${currentTaskId}`);
            const data = await response.json();
            
            if (data.status === 'completed') {
                clearInterval(checkInterval);
                updateProgress(100, 'Download completed!');
                showDownloadResult(data);
            } else if (data.status === 'error') {
                clearInterval(checkInterval);
                showError(data.message);
            } else if (data.status === 'processing') {
                updateProgress(data.progress, data.message);
            }
        } catch (error) {
            console.error('Progress check error:', error);
        }
    }, 1000);
}

// Update progress UI
function updateProgress(percentage, message) {
    progressFill.style.width = `${percentage}%`;
    progressPercentage.textContent = `${percentage}%`;
    progressText.textContent = message;
}

// Show download result
function showDownloadResult(data) {
    progressActions.classList.remove('hidden');
    
    if (data.download_url) {
        downloadLink.href = data.download_url;
        downloadLink.download = data.filename || 'video.mp4';
        
        // Auto click after 1 second
        setTimeout(() => {
            downloadLink.click();
        }, 1000);
    }
}

// Reset UI
function resetUI() {
    infoSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    videoUrlInput.value = '';
    videoUrlInput.focus();
    
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
    
    currentTaskId = null;
    currentVideoInfo = null;
    selectedFormat = 'best';
    
    // Reset progress
    updateProgress(0, 'Starting download...');
    progressActions.classList.add('hidden');
}

// Utility functions
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (!bytes) return 'Unknown';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i];
}

// Loading functions
function showLoading(message) {
    loadingText.textContent = message;
    loadingModal.classList.remove('hidden');
}

function hideLoading() {
    loadingModal.classList.add('hidden');
}

function showError(message) {
    alert(message); // Replace with better error UI
}

// Load recent URLs from localStorage
function loadRecentUrls() {
    const recent = JSON.parse(localStorage.getItem('recentUrls') || '[]');
    // Could implement recent URLs dropdown
}

// Save URL to recent
function saveToRecent(url) {
    const recent = JSON.parse(localStorage.getItem('recentUrls') || '[]');
    const updated = [url, ...recent.filter(u => u !== url)].slice(0, 10);
    localStorage.setItem('recentUrls', JSON.stringify(updated));
}

// Handle offline/online status
window.addEventListener('online', () => {
    showError('You are back online!');
});

window.addEventListener('offline', () => {
    showError('You are offline. Please check your connection.');
});

// Service Worker for PWA (optional)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(error => {
            console.error('Service Worker registration failed:', error);
        });
    });
}
