import os
import re
import json
import yt_dlp
import requests
from flask import Flask, render_template, request, jsonify, send_file, abort
from flask_cors import CORS
from urllib.parse import urlparse, parse_qs
import instaloader
from pytube import YouTube
import logging
from datetime import datetime
import uuid
import threading

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max
app.config['DOWNLOAD_FOLDER'] = 'downloads'
app.secret_key = os.urandom(24)

# Ensure download folder exists
os.makedirs(app.config['DOWNLOAD_FOLDER'], exist_ok=True)

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# In-memory storage for download progress (use Redis in production)
download_status = {}

class DownloadProgress:
    def __init__(self):
        self.status = "pending"
        self.progress = 0
        self.message = ""
        self.filename = ""
        self.download_url = ""

def detect_platform(url):
    """Detect which platform the URL belongs to"""
    patterns = {
        'youtube': [
            r'(https?://)?(www\.)?(youtube\.com|youtu\.be)',
            r'youtube\.com/watch\?v=',
            r'youtu\.be/'
        ],
        'tiktok': [
            r'(https?://)?(www\.)?(tiktok\.com)',
            r'(https?://)?(vm\.tiktok\.com)',
            r'(https?://)?(vt\.tiktok\.com)'
        ],
        'instagram': [
            r'(https?://)?(www\.)?(instagram\.com)',
            r'(https?://)?(instagr\.am)'
        ],
        'twitter': [
            r'(https?://)?(www\.)?(twitter\.com|x\.com)',
            r'(https?://)?(twitter\.com)/[^/]+/status/'
        ],
        'facebook': [
            r'(https?://)?(www\.)?(facebook\.com)',
            r'(https?://)?(fb\.watch)'
        ]
    }
    
    for platform, pattern_list in patterns.items():
        for pattern in pattern_list:
            if re.search(pattern, url, re.IGNORECASE):
                return platform
    return 'unknown'

def get_video_info_ytdl(url):
    """Get video information using yt-dlp"""
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Format data for response
            video_info = {
                'title': info.get('title', 'Unknown Title'),
                'duration': info.get('duration', 0),
                'thumbnail': info.get('thumbnail', ''),
                'uploader': info.get('uploader', ''),
                'formats': []
            }
            
            # Get available formats
            if 'formats' in info:
                for fmt in info['formats']:
                    if fmt.get('vcodec') != 'none' and fmt.get('acodec') != 'none':  # Video with audio
                        video_info['formats'].append({
                            'format_id': fmt.get('format_id'),
                            'ext': fmt.get('ext'),
                            'resolution': fmt.get('resolution', 'N/A'),
                            'filesize': fmt.get('filesize'),
                            'format_note': fmt.get('format_note', '')
                        })
            
            return {'success': True, 'info': video_info}
    except Exception as e:
        logger.error(f"Error getting video info: {str(e)}")
        return {'success': False, 'error': str(e)}

def download_video_ytdl(url, format_id='best', task_id=None):
    """Download video using yt-dlp"""
    try:
        # Generate unique filename
        unique_id = str(uuid.uuid4())[:8]
        output_template = os.path.join(
            app.config['DOWNLOAD_FOLDER'], 
            f'%(title)s_{unique_id}.%(ext)s'
        )
        
        ydl_opts = {
            'format': format_id,
            'outtmpl': output_template,
            'quiet': False,
            'progress_hooks': [lambda d: progress_hook(d, task_id)],
            'merge_output_format': 'mp4',
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            
            # Ensure .mp4 extension
            if not filename.endswith('.mp4'):
                new_filename = os.path.splitext(filename)[0] + '.mp4'
                if os.path.exists(filename):
                    os.rename(filename, new_filename)
                filename = new_filename
            
            return {
                'success': True,
                'filename': os.path.basename(filename),
                'title': info.get('title', 'video'),
                'duration': info.get('duration', 0)
            }
            
    except Exception as e:
        logger.error(f"Download error: {str(e)}")
        return {'success': False, 'error': str(e)}

def progress_hook(d, task_id):
    """Update download progress"""
    if task_id and task_id in download_status:
        if d['status'] == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate')
            downloaded = d.get('downloaded_bytes', 0)
            if total:
                download_status[task_id].progress = int((downloaded / total) * 100)
                download_status[task_id].message = f"Downloading: {download_status[task_id].progress}%"
        elif d['status'] == 'finished':
            download_status[task_id].progress = 100
            download_status[task_id].message = "Processing video..."
        elif d['status'] == 'error':
            download_status[task_id].status = 'error'
            download_status[task_id].message = "Download error"

# ========== ROUTES ==========

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/detect', methods=['POST'])
def api_detect():
    """Detect platform from URL"""
    data = request.get_json()
    url = data.get('url', '').strip()
    
    if not url:
        return jsonify({'error': 'URL is required'}), 400
    
    platform = detect_platform(url)
    return jsonify({'platform': platform})

@app.route('/api/info', methods=['POST'])
def api_info():
    """Get video information"""
    data = request.get_json()
    url = data.get('url', '').strip()
    
    if not url:
        return jsonify({'error': 'URL is required'}), 400
    
    result = get_video_info_ytdl(url)
    if result['success']:
        return jsonify(result['info'])
    else:
        return jsonify({'error': result['error']}), 500

@app.route('/api/download', methods=['POST'])
def api_download():
    """Start download process"""
    data = request.get_json()
    url = data.get('url', '').strip()
    format_id = data.get('format', 'best')
    
    if not url:
        return jsonify({'error': 'URL is required'}), 400
    
    # Generate task ID
    task_id = str(uuid.uuid4())
    download_status[task_id] = DownloadProgress()
    download_status[task_id].status = 'processing'
    download_status[task_id].message = 'Starting download...'
    
    # Start download in background thread
    def download_task():
        try:
            result = download_video_ytdl(url, format_id, task_id)
            if result['success']:
                download_status[task_id].status = 'completed'
                download_status[task_id].message = 'Download completed'
                download_status[task_id].filename = result['filename']
                download_status[task_id].download_url = f'/api/file/{result["filename"]}'
            else:
                download_status[task_id].status = 'error'
                download_status[task_id].message = f'Error: {result["error"]}'
        except Exception as e:
            download_status[task_id].status = 'error'
            download_status[task_id].message = f'Error: {str(e)}'
    
    thread = threading.Thread(target=download_task)
    thread.start()
    
    return jsonify({'task_id': task_id, 'message': 'Download started'})

@app.route('/api/status/<task_id>', methods=['GET'])
def api_status(task_id):
    """Check download status"""
    if task_id not in download_status:
        return jsonify({'error': 'Task not found'}), 404
    
    status = download_status[task_id]
    return jsonify({
        'status': status.status,
        'progress': status.progress,
        'message': status.message,
        'download_url': status.download_url if status.status == 'completed' else None,
        'filename': status.filename if status.status == 'completed' else None
    })

@app.route('/api/file/<filename>', methods=['GET'])
def api_file(filename):
    """Serve downloaded file"""
    filepath = os.path.join(app.config['DOWNLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        abort(404)
    
    # Clean old files (older than 1 hour)
    try:
        for f in os.listdir(app.config['DOWNLOAD_FOLDER']):
            fpath = os.path.join(app.config['DOWNLOAD_FOLDER'], f)
            if os.path.getmtime(fpath) < datetime.now().timestamp() - 3600:
                os.remove(fpath)
    except:
        pass
    
    return send_file(filepath, as_attachment=True)

@app.route('/api/supported', methods=['GET'])
def api_supported():
    """Get list of supported platforms"""
    return jsonify({
        'platforms': [
            {
                'name': 'YouTube',
                'icon': 'youtube',
                'colors': ['#FF0000', '#282828'],
                'formats': ['MP4 1080p', 'MP4 720p', 'MP4 360p', 'MP3 Audio']
            },
            {
                'name': 'TikTok',
                'icon': 'tiktok',
                'colors': ['#000000', '#69C9D0', '#EE1D52'],
                'formats': ['MP4 HD', 'MP4 SD', 'MP3 Audio']
            },
            {
                'name': 'Instagram',
                'icon': 'instagram',
                'colors': ['#E4405F', '#405DE6'],
                'formats': ['MP4 HD', 'MP4 SD', 'Image']
            },
            {
                'name': 'Twitter/X',
                'icon': 'twitter',
                'colors': ['#000000', '#FFFFFF'],
                'formats': ['MP4 HD', 'MP4 SD', 'GIF']
            },
            {
                'name': 'Facebook',
                'icon': 'facebook',
                'colors': ['#1877F2', '#FFFFFF'],
                'formats': ['MP4 HD', 'MP4 SD']
            }
        ]
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)