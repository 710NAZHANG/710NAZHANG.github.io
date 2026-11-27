'use strict';

document.documentElement.classList.add('js');

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#primary-nav');
if (menuButton && navigation) {
  const closeMenu = () => {
    navigation.classList.remove('is-open');
    menuButton.setAttribute('aria-expanded', 'false');
  };
  menuButton.addEventListener('click', () => {
    const open = navigation.classList.toggle('is-open');
    menuButton.setAttribute('aria-expanded', String(open));
  });
  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && navigation.classList.contains('is-open')) {
      closeMenu();
      menuButton.focus();
    }
  });
}

const filterForm = document.querySelector('.publication-filters');
if (filterForm) {
  const search = document.querySelector('#publication-search');
  const year = document.querySelector('#publication-year');
  const status = document.querySelector('#publication-status');
  const empty = document.querySelector('.no-results');
  const papers = Array.from(document.querySelectorAll('.publication-item'));
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const searchablePapers = papers.map(element => ({element, text: normalize(element.textContent)}));
  const applyFilters = () => {
    const terms = normalize(search.value).split(' ').filter(Boolean);
    let visible = 0;
    searchablePapers.forEach(({element, text}) => {
      const match = (year.value === 'all' || element.dataset.year === year.value) && terms.every(term => text.includes(term));
      element.hidden = !match;
      if (match) visible += 1;
    });
    status.textContent = `${visible} ${visible === 1 ? 'publication' : 'publications'}${visible !== papers.length ? ` of ${papers.length}` : ''}`;
    empty.hidden = visible !== 0;
  };
  filterForm.hidden = false;
  filterForm.addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
  search.addEventListener('input', applyFilters);
  year.addEventListener('change', applyFilters);
  document.querySelector('#clear-filters').addEventListener('click', () => {
    search.value = '';
    year.value = 'all';
    applyFilters();
    search.focus();
  });
}

const printButton = document.querySelector('.print-cv');
if (printButton) {
  printButton.hidden = false;
  printButton.addEventListener('click', () => window.print());
}
