from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import httpx
import asyncio
import xml.etree.ElementTree as ET
import os
from dotenv import load_dotenv
import re

load_dotenv()

app = FastAPI(title="CuraLink Research Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HF_API_KEY = os.getenv("HF_API_KEY", "")
HF_MODEL = "mistralai/Mistral-7B-Instruct-v0.3"
HF_API_URL = f"https://api-inference.huggingface.co/models/{HF_MODEL}"


# ── MODELS ────────────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    disease: str
    query: str
    location: Optional[str] = ""
    patient_name: Optional[str] = ""
    conversation_history: Optional[List[dict]] = []


class ResearchResponse(BaseModel):
    answer: str
    publications: List[dict]
    clinical_trials: List[dict]
    sources_used: int


# ── PUBMED ────────────────────────────────────────────────────────────────────

async def fetch_pubmed(disease: str, query: str, max_results: int = 80) -> List[dict]:
    expanded_query = f"{query} {disease}".strip()
    search_term = expanded_query.replace(" ", "+")

    search_url = (
        f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
        f"?db=pubmed&term={search_term}&retmax={max_results}"
        f"&sort=pub+date&retmode=json"
    )

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(search_url)
            data = resp.json()
            ids = data.get("esearchresult", {}).get("idlist", [])

            if not ids:
                return []

            ids_str = ",".join(ids[:50])
            fetch_url = (
                f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
                f"?db=pubmed&id={ids_str}&retmode=xml"
            )
            fetch_resp = await client.get(fetch_url)
            return parse_pubmed_xml(fetch_resp.text)
    except Exception as e:
        print(f"PubMed error: {e}")
        return []


def parse_pubmed_xml(xml_text: str) -> List[dict]:
    papers = []
    try:
        root = ET.fromstring(xml_text)
        for article in root.findall(".//PubmedArticle"):
            try:
                title_el = article.find(".//ArticleTitle")
                abstract_el = article.find(".//AbstractText")
                year_el = article.find(".//PubDate/Year")
                pmid_el = article.find(".//PMID")

                authors = []
                for author in article.findall(".//Author")[:3]:
                    last = author.find("LastName")
                    first = author.find("ForeName")
                    if last is not None:
                        name = last.text or ""
                        if first is not None:
                            name += f" {first.text or ''}"
                        authors.append(name.strip())

                title = title_el.text if title_el is not None else "Unknown Title"
                abstract = abstract_el.text if abstract_el is not None else ""
                year = year_el.text if year_el is not None else "N/A"
                pmid = pmid_el.text if pmid_el is not None else ""

                if title and abstract:
                    papers.append({
                        "title": title,
                        "abstract": abstract[:400] + "..." if len(abstract) > 400 else abstract,
                        "authors": authors,
                        "year": year,
                        "source": "PubMed",
                        "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else "",
                        "pmid": pmid,
                        "relevance_score": 0
                    })
            except Exception:
                continue
    except Exception as e:
        print(f"XML parse error: {e}")
    return papers


# ── OPENALEX ──────────────────────────────────────────────────────────────────

async def fetch_openalex(disease: str, query: str, max_results: int = 80) -> List[dict]:
    expanded_query = f"{query} {disease}".strip().replace(" ", "+")
    url = (
        f"https://api.openalex.org/works"
        f"?search={expanded_query}"
        f"&per-page=50&page=1"
        f"&sort=relevance_score:desc"
        f"&filter=from_publication_date:2018-01-01"
    )

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers={"User-Agent": "CuraLink/1.0 (mailto:nikhilbt18@gmail.com)"})
            data = resp.json()
            results = data.get("results", [])
            papers = []

            for work in results:
                title = work.get("title", "")
                abstract_inverted = work.get("abstract_inverted_index")
                abstract = reconstruct_abstract(abstract_inverted) if abstract_inverted else ""
                year = work.get("publication_year", "N/A")
                url_link = work.get("doi", "") or work.get("id", "")
                authors = [
                    a.get("author", {}).get("display_name", "")
                    for a in work.get("authorships", [])[:3]
                ]

                if title and abstract:
                    papers.append({
                        "title": title,
                        "abstract": abstract[:400] + "..." if len(abstract) > 400 else abstract,
                        "authors": [a for a in authors if a],
                        "year": str(year),
                        "source": "OpenAlex",
                        "url": url_link,
                        "relevance_score": work.get("relevance_score", 0) or 0
                    })

            return papers
    except Exception as e:
        print(f"OpenAlex error: {e}")
        return []


def reconstruct_abstract(inverted_index: dict) -> str:
    if not inverted_index:
        return ""
    words = {}
    for word, positions in inverted_index.items():
        for pos in positions:
            words[pos] = word
    return " ".join(words[i] for i in sorted(words.keys()))


# ── CLINICAL TRIALS ───────────────────────────────────────────────────────────

async def fetch_clinical_trials(disease: str, location: str = "", max_results: int = 50) -> List[dict]:
    params = f"query.cond={disease.replace(' ', '+')}&pageSize={max_results}&format=json"
    if location:
        params += f"&query.locn={location.replace(' ', '+')}"

    url = f"https://clinicaltrials.gov/api/v2/studies?{params}"

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url)
            data = resp.json()
            studies = data.get("studies", [])
            trials = []

            for study in studies:
                proto = study.get("protocolSection", {})
                ident = proto.get("identificationModule", {})
                status = proto.get("statusModule", {})
                desc = proto.get("descriptionModule", {})
                eligibility = proto.get("eligibilityModule", {})
                contacts = proto.get("contactsLocationsModule", {})

                title = ident.get("briefTitle", "")
                overall_status = status.get("overallStatus", "")
                brief_summary = desc.get("briefSummary", "")
                criteria = eligibility.get("eligibilityCriteria", "")[:300]
                nct_id = ident.get("nctId", "")

                location_list = []
                for loc in contacts.get("locations", [])[:2]:
                    loc_str = f"{loc.get('city', '')}, {loc.get('country', '')}".strip(", ")
                    if loc_str:
                        location_list.append(loc_str)

                contact_info = ""
                central_contacts = contacts.get("centralContacts", [])
                if central_contacts:
                    c = central_contacts[0]
                    contact_info = f"{c.get('name', '')} — {c.get('phone', '')} {c.get('email', '')}".strip(" —")

                if title:
                    trials.append({
                        "title": title,
                        "status": overall_status,
                        "summary": brief_summary[:300] + "..." if len(brief_summary) > 300 else brief_summary,
                        "eligibility": criteria,
                        "locations": location_list,
                        "contact": contact_info,
                        "url": f"https://clinicaltrials.gov/study/{nct_id}" if nct_id else "",
                        "nct_id": nct_id
                    })

            return trials
    except Exception as e:
        print(f"ClinicalTrials error: {e}")
        return []


# ── RANKING ───────────────────────────────────────────────────────────────────

def rank_publications(papers: List[dict], disease: str, query: str) -> List[dict]:
    keywords = set((disease + " " + query).lower().split())
    current_year = 2025

    for paper in papers:
        score = 0
        text = (paper.get("title", "") + " " + paper.get("abstract", "")).lower()

        # Keyword relevance
        for kw in keywords:
            if len(kw) > 3 and kw in text:
                score += 3

        # Recency bonus
        try:
            year = int(paper.get("year", 2000))
            score += max(0, (year - 2015) * 2)
        except Exception:
            pass

        # OpenAlex relevance score
        score += float(paper.get("relevance_score", 0)) * 0.1

        # Abstract quality
        if len(paper.get("abstract", "")) > 100:
            score += 2

        paper["final_score"] = score

    return sorted(papers, key=lambda x: x.get("final_score", 0), reverse=True)


def rank_trials(trials: List[dict], disease: str) -> List[dict]:
    keywords = set(disease.lower().split())
    priority_status = {"RECRUITING": 5, "ACTIVE_NOT_RECRUITING": 3, "COMPLETED": 2}

    for trial in trials:
        score = priority_status.get(trial.get("status", ""), 0)
        text = (trial.get("title", "") + " " + trial.get("summary", "")).lower()
        for kw in keywords:
            if len(kw) > 3 and kw in text:
                score += 2
        trial["final_score"] = score

    return sorted(trials, key=lambda x: x.get("final_score", 0), reverse=True)


# ── LLM REASONING ─────────────────────────────────────────────────────────────

def build_prompt(disease: str, query: str, location: str,
                 publications: List[dict], trials: List[dict],
                 history: List[dict]) -> str:

    history_text = ""
    if history:
        for turn in history[-3:]:
            role = turn.get("role", "")
            content = turn.get("content", "")
            if role == "user":
                history_text += f"User: {content}\n"
            elif role == "assistant":
                history_text += f"Assistant: {content[:200]}...\n"

    pub_text = ""
    for i, p in enumerate(publications[:6], 1):
        pub_text += f"{i}. [{p['source']}] {p['title']} ({p['year']})\n   {p['abstract'][:200]}\n\n"

    trial_text = ""
    for i, t in enumerate(trials[:4], 1):
        trial_text += f"{i}. {t['title']} — Status: {t['status']}\n   {t['summary'][:150]}\n\n"

    prompt = f"""<s>[INST] You are CuraLink, a medical research assistant. Answer research-backed questions using provided publications and clinical trials. Be accurate, structured, and cite sources.

Disease: {disease}
User Location: {location or 'Not specified'}
User Query: {query}

{f'Conversation Context:{chr(10)}{history_text}' if history_text else ''}

Recent Research Publications:
{pub_text if pub_text else 'No publications found.'}

Clinical Trials:
{trial_text if trial_text else 'No clinical trials found.'}

Provide a structured response with:
1. Condition Overview (2-3 sentences)
2. Key Research Insights (from publications above)
3. Relevant Clinical Trials (if any)
4. Important Note

Keep response concise, factual, and always cite source titles. [/INST]"""

    return prompt


async def call_hf_llm(prompt: str) -> str:
    if not HF_API_KEY:
        return generate_fallback_response(prompt)

    headers = {"Authorization": f"Bearer {HF_API_KEY}"}
    payload = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": 600,
            "temperature": 0.3,
            "top_p": 0.9,
            "do_sample": True,
            "return_full_text": False
        }
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(HF_API_URL, json=payload, headers=headers)
            result = resp.json()

            if isinstance(result, list) and result:
                text = result[0].get("generated_text", "")
                return text.strip() or generate_fallback_response(prompt)
            elif isinstance(result, dict) and "error" in result:
                print(f"HF error: {result['error']}")
                return generate_fallback_response(prompt)
            return generate_fallback_response(prompt)
    except Exception as e:
        print(f"LLM call error: {e}")
        return generate_fallback_response(prompt)


def generate_fallback_response(prompt: str) -> str:
    # Extract disease and query from prompt for fallback
    lines = prompt.split("\n")
    disease = ""
    query = ""
    for line in lines:
        if line.startswith("Disease:"):
            disease = line.replace("Disease:", "").strip()
        if line.startswith("User Query:"):
            query = line.replace("User Query:", "").strip()

    return f"""**Condition Overview**
Based on current medical research, {disease} is an active area of investigation with multiple ongoing studies and clinical trials.

**Key Research Insights**
The retrieved publications above represent recent peer-reviewed research on {query} in the context of {disease}. Please review each publication directly for detailed findings, methodology, and conclusions.

**Clinical Trials**
The clinical trials listed above represent ongoing and recently completed studies. Check ClinicalTrials.gov for eligibility and enrollment information.

**Important Note**
This information is for research purposes only. Always consult a qualified healthcare professional for medical advice specific to your condition.

*Sources: See publications and clinical trials listed below*"""


# ── MAIN ENDPOINT ─────────────────────────────────────────────────────────────

@app.post("/research", response_model=ResearchResponse)
async def research(req: QueryRequest):
    if not req.disease:
        raise HTTPException(status_code=400, detail="Disease is required")

    # Fetch all sources in parallel
    pub_results, oa_results, trial_results = await asyncio.gather(
        fetch_pubmed(req.disease, req.query),
        fetch_openalex(req.disease, req.query),
        fetch_clinical_trials(req.disease, req.location or "")
    )

    # Merge and deduplicate publications
    all_papers = pub_results + oa_results
    seen_titles = set()
    unique_papers = []
    for p in all_papers:
        title_key = p["title"].lower()[:50]
        if title_key not in seen_titles:
            seen_titles.add(title_key)
            unique_papers.append(p)

    # Rank
    ranked_papers = rank_publications(unique_papers, req.disease, req.query)
    ranked_trials = rank_trials(trial_results, req.disease)

    # Top results
    top_papers = ranked_papers[:8]
    top_trials = ranked_trials[:6]

    # LLM reasoning
    prompt = build_prompt(
        req.disease, req.query, req.location or "",
        top_papers, top_trials,
        req.conversation_history or []
    )
    answer = await call_hf_llm(prompt)

    return ResearchResponse(
        answer=answer,
        publications=top_papers,
        clinical_trials=top_trials,
        sources_used=len(top_papers) + len(top_trials)
    )


@app.get("/health")
async def health():
    return {"status": "ok", "service": "CuraLink Research Engine"}


@app.get("/")
async def root():
    return {"message": "CuraLink API — Medical Research Assistant"}
