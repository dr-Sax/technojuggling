"""
Juggler's World Archive Search Tool - UPDATED VERSION

This script downloads and indexes articles from the Juggler's World magazine archives
(1970s-1997) by crawling through ALL individual pages within each issue.

Usage:
    # First time: Download the archive
    python juggling_archive_search.py --download
    
    # Search the archive
    python juggling_archive_search.py --search "siteswap"
    
    # Search with more context
    python juggling_archive_search.py --search "notation" --context 200
    
    # Export results to CSV
    python juggling_archive_search.py --search "Michael Moschen" --export results.csv
"""

import requests
from bs4 import BeautifulSoup
import re
from urllib.parse import urljoin, urlparse
import time
import pickle
from pathlib import Path
import pandas as pd
from datetime import datetime
import argparse
import sys


class JugglingArchiveSearcher:
    """Main class for downloading and searching Juggler's World archives"""
    
    def __init__(self, save_dir='juggling_archive', delay=0.3):
        """
        Initialize the archive searcher
        
        Args:
            save_dir (str): Directory to save downloaded articles
            delay (float): Seconds to wait between requests
        """
        self.save_dir = Path(save_dir)
        self.save_dir.mkdir(exist_ok=True)
        self.archive_file = self.save_dir / 'archive.pkl'
        self.delay = delay
        
        # Index pages covering different time periods
        self.index_urls = [
            'https://dev.juggle.org/history/archives/jugmags/Index2-4/index_1.htm',  # 1970s-1980s
            'https://dev.juggle.org/history/archives/jugmags/Index2-4/index_2.htm',  # 1980s-1990
            'https://dev.juggle.org/history/archives/jugmags/Index2-4/index_3.htm',  # 1990-1997
        ]
        
        self.archive = None
        self.visited_urls = set()  # Track visited URLs to avoid duplicates
    
    def get_issue_toc_links(self, index_url):
        """
        Extract links to issue table of contents pages from an index page
        
        Args:
            index_url (str): URL of the index page
            
        Returns:
            list: List of URLs to issue TOC pages
        """
        print(f"Fetching index: {index_url}")
        try:
            response = requests.get(index_url, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            
            links = []
            for link in soup.find_all('a', href=True):
                href = link['href']
                # Look for links that point to issue TOC pages
                if href.startswith('../') and any(x in href for x in [',p', 'index', '-p']):
                    full_url = urljoin(index_url, href)
                    links.append(full_url)
            
            # Remove duplicates while preserving order
            seen = set()
            unique_links = []
            for link in links:
                if link not in seen:
                    seen.add(link)
                    unique_links.append(link)
            
            print(f"  Found {len(unique_links)} issue TOC links")
            return unique_links
            
        except Exception as e:
            print(f"  Error fetching index: {e}")
            return []
    
    def get_all_pages_in_issue(self, toc_url):
        """
        Get all page URLs within a single issue by following next/previous links
        
        Args:
            toc_url (str): URL of the issue's table of contents or first page
            
        Returns:
            list: List of all page URLs in the issue
        """
        pages = []
        current_url = toc_url
        issue_base = '/'.join(toc_url.split('/')[:-1])  # Get base directory for this issue
        
        visited_in_issue = set()
        
        try:
            while current_url and current_url not in visited_in_issue:
                visited_in_issue.add(current_url)
                pages.append(current_url)
                
                # Fetch the page to find next page link
                response = requests.get(current_url, timeout=10)
                soup = BeautifulSoup(response.content, 'html.parser')
                
                # Look for "Next Page" link
                next_url = None
                for link in soup.find_all('a', href=True):
                    text = link.get_text().lower()
                    href = link['href']
                    
                    if 'next' in text and ('page' in text or '--->' in text):
                        # Convert relative URL to absolute
                        next_url = urljoin(current_url, href)
                        
                        # Only follow if it's in the same issue
                        if next_url.startswith(issue_base):
                            break
                        else:
                            next_url = None
                
                current_url = next_url
                time.sleep(self.delay)
                
        except Exception as e:
            print(f"    Error crawling issue pages: {e}")
        
        return pages
    
    def download_page(self, url):
        """
        Download a single page
        
        Args:
            url (str): URL of the page
            
        Returns:
            dict: Page data (url, title, text, html) or None if error
        """
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Extract title
            title = ''
            if soup.title:
                title = soup.title.string or ''
            
            # Get text content
            text = soup.get_text()
            
            # Clean up excessive whitespace
            text = re.sub(r'\n\s*\n', '\n\n', text)
            text = re.sub(r' +', ' ', text)
            
            # Extract issue info from URL if possible
            issue_info = ''
            url_parts = url.split('/')
            if len(url_parts) >= 2:
                issue_info = url_parts[-2]  # e.g., "46-1"
            
            return {
                'url': url,
                'title': title.strip(),
                'text': text,
                'html': str(soup),
                'issue': issue_info,
                'download_date': datetime.now().isoformat()
            }
            
        except Exception as e:
            print(f"    Error downloading {url}: {e}")
            return None
    
    def build_archive(self, force_refresh=False):
        """
        Download all pages from all issues and create searchable archive
        
        Args:
            force_refresh (bool): If True, re-download even if archive exists
        """
        # Check if archive already exists
        if self.archive_file.exists() and not force_refresh:
            print(f"Archive already exists at {self.archive_file}")
            print("Use --force to re-download")
            self.load_archive()
            return
        
        print("Building archive from Juggler's World magazines...")
        print("This will download ALL individual pages from each issue.")
        print(f"Results will be saved to {self.archive_file}")
        print("This may take 30-60 minutes depending on connection speed.")
        print("-" * 70)
        
        all_pages = []
        self.visited_urls = set()
        
        # Process each index page
        for index_url in self.index_urls:
            issue_toc_links = self.get_issue_toc_links(index_url)
            
            print(f"\nProcessing {len(issue_toc_links)} issues from this index...")
            
            for i, toc_url in enumerate(issue_toc_links, 1):
                if toc_url in self.visited_urls:
                    continue
                
                print(f"\n  [{i}/{len(issue_toc_links)}] Processing issue: {toc_url}")
                
                # Get all pages in this issue
                page_urls = self.get_all_pages_in_issue(toc_url)
                print(f"    Found {len(page_urls)} pages in this issue")
                
                # Download each page
                for j, page_url in enumerate(page_urls, 1):
                    if page_url in self.visited_urls:
                        continue
                    
                    self.visited_urls.add(page_url)
                    print(f"    Downloading page {j}/{len(page_urls)}: {page_url.split('/')[-1]}")
                    
                    page_data = self.download_page(page_url)
                    if page_data:
                        all_pages.append(page_data)
                    
                    time.sleep(self.delay)
        
        print("\n" + "=" * 70)
        print(f"Downloaded {len(all_pages)} total pages")
        
        # Save archive
        with open(self.archive_file, 'wb') as f:
            pickle.dump(all_pages, f)
        
        print(f"Archive saved to {self.archive_file}")
        self.archive = all_pages
    
    def load_archive(self):
        """Load previously downloaded archive from disk"""
        if not self.archive_file.exists():
            print(f"No archive found at {self.archive_file}")
            print("Please run with --download first")
            return False
        
        print(f"Loading archive from {self.archive_file}...")
        with open(self.archive_file, 'rb') as f:
            self.archive = pickle.load(f)
        
        print(f"Loaded {len(self.archive)} pages")
        return True
    
    def search(self, keyword, context_chars=150, case_sensitive=False):
        """
        Search the archive for a keyword
        
        Args:
            keyword (str): Keyword to search for
            context_chars (int): Number of characters to show on each side of match
            case_sensitive (bool): Whether search is case-sensitive
            
        Returns:
            pandas.DataFrame: Search results
        """
        if self.archive is None:
            if not self.load_archive():
                return pd.DataFrame()
        
        print(f"Searching for '{keyword}' in {len(self.archive)} pages...")
        print("-" * 70)
        
        results = []
        
        for page in self.archive:
            text = page['text']
            search_text = text if case_sensitive else text.lower()
            search_keyword = keyword if case_sensitive else keyword.lower()
            
            if search_keyword in search_text:
                # Find all occurrences with context
                matches = []
                idx = 0
                
                while idx < len(search_text):
                    idx = search_text.find(search_keyword, idx)
                    if idx == -1:
                        break
                    
                    # Extract context
                    start = max(0, idx - context_chars)
                    end = min(len(text), idx + len(keyword) + context_chars)
                    context = text[start:end]
                    
                    # Add ellipsis if truncated
                    if start > 0:
                        context = '...' + context
                    if end < len(text):
                        context = context + '...'
                    
                    matches.append(context)
                    idx += len(keyword)
                
                results.append({
                    'url': page['url'],
                    'title': page['title'],
                    'issue': page.get('issue', ''),
                    'match_count': len(matches),
                    'matches': matches[:10],  # Keep first 10 matches
                    'first_match': matches[0] if matches else ''
                })
        
        print(f"Found {len(results)} pages containing '{keyword}'")
        
        # Count unique issues
        if results:
            unique_issues = len(set(r['issue'] for r in results if r.get('issue')))
            print(f"Across {unique_issues} different issues")
        
        return pd.DataFrame(results)
    
    def search_regex(self, pattern, context_chars=150):
        """
        Search using regular expression
        
        Args:
            pattern (str): Regular expression pattern
            context_chars (int): Characters of context around match
            
        Returns:
            pandas.DataFrame: Search results
        """
        if self.archive is None:
            if not self.load_archive():
                return pd.DataFrame()
        
        print(f"Searching with regex pattern: {pattern}")
        print("-" * 70)
        
        results = []
        regex = re.compile(pattern, re.IGNORECASE)
        
        for page in self.archive:
            text = page['text']
            matches = []
            
            for match in regex.finditer(text):
                start = max(0, match.start() - context_chars)
                end = min(len(text), match.end() + context_chars)
                context = text[start:end]
                
                if start > 0:
                    context = '...' + context
                if end < len(text):
                    context = context + '...'
                
                matches.append({
                    'matched_text': match.group(),
                    'context': context
                })
            
            if matches:
                results.append({
                    'url': page['url'],
                    'title': page['title'],
                    'issue': page.get('issue', ''),
                    'match_count': len(matches),
                    'matches': matches[:10]
                })
        
        print(f"Found {len(results)} pages matching pattern")
        return pd.DataFrame(results)
    
    def display_results(self, results_df, max_matches_shown=3):
        """
        Pretty print search results
        
        Args:
            results_df (pandas.DataFrame): Search results
            max_matches_shown (int): Maximum number of match contexts to show per page
        """
        if results_df.empty:
            print("No results found")
            return
        
        print("\n" + "=" * 70)
        print(f"SEARCH RESULTS: {len(results_df)} pages found")
        print("=" * 70)
        
        for idx, row in results_df.iterrows():
            print(f"\n[{idx + 1}] {row['title']}")
            if row.get('issue'):
                print(f"    Issue: {row['issue']}")
            print(f"    URL: {row['url']}")
            print(f"    Matches: {row['match_count']}")
            
            # Show first few matches
            if 'matches' in row and row['matches']:
                print(f"    Context:")
                for i, match in enumerate(row['matches'][:max_matches_shown]):
                    print(f"      {i+1}. {match}")
                
                if row['match_count'] > max_matches_shown:
                    print(f"      ... and {row['match_count'] - max_matches_shown} more")
            
            print()
    
    def export_results(self, results_df, output_file):
        """
        Export results to CSV
        
        Args:
            results_df (pandas.DataFrame): Search results
            output_file (str): Path to output CSV file
        """
        if results_df.empty:
            print("No results to export")
            return
        
        # Prepare data for export (flatten matches list)
        export_data = []
        for _, row in results_df.iterrows():
            base_data = {
                'url': row['url'],
                'title': row['title'],
                'issue': row.get('issue', ''),
                'match_count': row['match_count']
            }
            
            if 'matches' in row and row['matches']:
                for i, match in enumerate(row['matches'], 1):
                    export_data.append({
                        **base_data,
                        'match_number': i,
                        'context': match
                    })
            else:
                export_data.append(base_data)
        
        export_df = pd.DataFrame(export_data)
        export_df.to_csv(output_file, index=False)
        print(f"Results exported to {output_file}")
    
    def get_stats(self):
        """Get statistics about the archive"""
        if self.archive is None:
            if not self.load_archive():
                return
        
        print("\n" + "=" * 70)
        print("ARCHIVE STATISTICS")
        print("=" * 70)
        print(f"Total pages: {len(self.archive)}")
        
        # Count unique issues
        issues = set(page.get('issue', '') for page in self.archive if page.get('issue'))
        print(f"Unique issues: {len(issues)}")
        
        total_words = sum(len(page['text'].split()) for page in self.archive)
        print(f"Total words: {total_words:,}")
        
        avg_words = total_words / len(self.archive) if self.archive else 0
        print(f"Average words per page: {avg_words:.0f}")
        
        # Get pages with titles
        titles = [page['title'] for page in self.archive if page['title']]
        print(f"Pages with titles: {len(titles)}")
        print()


def main():
    """Main entry point for command-line usage"""
    parser = argparse.ArgumentParser(
        description='Search Juggler\'s World magazine archives',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Download the archive (crawls all pages)
  python juggling_archive_search.py --download
  
  # Search for a keyword
  python juggling_archive_search.py --search "Jack Boyce"
  
  # Search with more context
  python juggling_archive_search.py --search "notation" --context 200
  
  # Case-sensitive search
  python juggling_archive_search.py --search "Moschen" --case-sensitive
  
  # Regex search
  python juggling_archive_search.py --regex "\\d+ ball"
  
  # Export results
  python juggling_archive_search.py --search "passing" --export results.csv
  
  # Show archive statistics
  python juggling_archive_search.py --stats
        """
    )
    
    parser.add_argument('--download', action='store_true',
                       help='Download and build the archive')
    parser.add_argument('--force', action='store_true',
                       help='Force re-download even if archive exists')
    parser.add_argument('--search', type=str,
                       help='Keyword to search for')
    parser.add_argument('--regex', type=str,
                       help='Regular expression pattern to search for')
    parser.add_argument('--context', type=int, default=150,
                       help='Number of characters to show around matches (default: 150)')
    parser.add_argument('--case-sensitive', action='store_true',
                       help='Make search case-sensitive')
    parser.add_argument('--export', type=str,
                       help='Export results to CSV file')
    parser.add_argument('--max-shown', type=int, default=3,
                       help='Maximum number of match contexts to display per page (default: 3)')
    parser.add_argument('--stats', action='store_true',
                       help='Show archive statistics')
    parser.add_argument('--dir', type=str, default='juggling_archive',
                       help='Directory to save/load archive (default: juggling_archive)')
    
    args = parser.parse_args()
    
    # Create searcher instance
    searcher = JugglingArchiveSearcher(save_dir=args.dir)
    
    # Handle download
    if args.download:
        searcher.build_archive(force_refresh=args.force)
        return
    
    # Handle stats
    if args.stats:
        searcher.get_stats()
        return
    
    # Handle search
    if args.search:
        results = searcher.search(
            args.search,
            context_chars=args.context,
            case_sensitive=args.case_sensitive
        )
        searcher.display_results(results, max_matches_shown=args.max_shown)
        
        if args.export:
            searcher.export_results(results, args.export)
        
        return
    
    # Handle regex search
    if args.regex:
        results = searcher.search_regex(args.regex, context_chars=args.context)
        searcher.display_results(results, max_matches_shown=args.max_shown)
        
        if args.export:
            searcher.export_results(results, args.export)
        
        return
    
    # If no action specified, show help
    parser.print_help()


if __name__ == '__main__':
    main()