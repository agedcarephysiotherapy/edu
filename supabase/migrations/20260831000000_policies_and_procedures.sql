-- Policies & Procedures library, with per-staff acknowledgment tracking
-- (the "Record a Completion" / "Record a Compliance Document" pattern
-- already used elsewhere: staff must actively confirm they've read the
-- current version of a policy, and managers can see who has/hasn't).
--
-- Content stored as plain text (not HTML) rendered client-side with
-- white-space:pre-wrap — deliberately avoids needing an HTML sanitizer for
-- a manager-editable field. Seeded below from the ACP Policy & Procedure
-- Manual (Google Doc, imported once at migration time — the source of
-- truth going forward is this table, editable by managers in-app).

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  body text not null,
  requires_acknowledgment boolean not null default true,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.policy_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (policy_id, staff_id)
);

alter table public.policies enable row level security;
alter table public.policy_acknowledgments enable row level security;

-- Any approved staff member can read active policies.
create policy "staff can read active policies"
  on public.policies for select
  to authenticated
  using (active = true or is_manager());

-- Only managers can author/edit/retire policies.
create policy "managers can manage policies"
  on public.policies for all
  to authenticated
  using (is_manager())
  with check (is_manager());

-- A staff member can see and record only their own acknowledgments;
-- managers can see everyone's (needed for the coverage view).
create policy "staff can read own acknowledgments"
  on public.policy_acknowledgments for select
  to authenticated
  using (staff_id = (select auth.uid()) or is_manager());

create policy "staff can acknowledge policies"
  on public.policy_acknowledgments for insert
  to authenticated
  with check (staff_id = (select auth.uid()));

create index idx_policy_acknowledgments_policy on public.policy_acknowledgments(policy_id);
create index idx_policy_acknowledgments_staff on public.policy_acknowledgments(staff_id);

-- Seed content imported from the ACP Policy & Procedure Manual.
insert into public.policies (title, category, body, requires_acknowledgment, sort_order) values
  ('Policy & Procedure Manual', 'General', $body$1. Introduction

Mission Statement:
To provide high-quality physiotherapy services that enhance the health, mobility, and quality of life for aged care residents.

Values:
• Compassion
• Respect
• Professionalism
• Integrity
• Continuous Improvement

Scope:
This document outlines key policies and procedures based on AHPRA standards, the code of conduct, and additional organisational guidelines. The manual aims to ensure compliance, quality care, and safety across all aspects of physiotherapy practice in aged care.

2. Governance and Compliance

AHPRA Guidelines

All physiotherapists must comply with AHPRA’s registration requirements, including maintaining current registration, completing Continuing Professional Development (CPD), and adhering to professional conduct standards.

Code of Conduct
• Professional Obligations: Uphold ethical standards, maintain patient confidentiality, ensure safety, and operate within the scope of practice.
• Patient-Centred Care: Respect patient dignity, obtain informed consent, and provide culturally competent care.
• Legislation Compliance:
• Workplace Health and Safety (WHS): Follow regulations to ensure safe work practices, especially in manual handling, infection control, and emergency protocols.
• Privacy and Confidentiality: Adhere to the Australian Privacy Principles regarding patient data management.
• Child Safety: Comply with mandatory reporting requirements and child-safe policies when treating minors.

3. Clinical Operations and Responsibilities

Therapist Arrival Procedures

Upon arrival at the facility:
• Conduct a Rapid Antigen Test (RAT) and document results.
• Sign in using the ACP timesheet app on your smartphone.
• Log into the facility-specific data management system and check for referrals, incidents, or unresolved messages.
• Review recent falls, incidents, or referrals and proceed with assessments and treatments as per the daily schedule.

Patient Assessments and Treatment
• Initial Assessments: Conduct a thorough assessment within 24 hours of admission and develop an individualised treatment plan.
• Progress Notes: Record each session’s outcomes, modifications, and patient feedback in the facility-specific data management system.
• Mobility Guide Updates: Use the ACP Mobility Guide Tool to update residents’ mobility guides and ensure they are printed and placed in the resident’s room. Mobility guides must be reviewed every three months or sooner if a resident's mobility changes.
• Post-Fall Reviews: After a fall, assess the resident’s condition, recommend strategies to prevent future falls, and update documentation accordingly.
• Wellness Program: Develop and document treatment plans for residents in wellness programs and review them every six months.

Referral Systems
• Refer patients to other healthcare professionals when necessary, ensuring proper documentation and that the patient understands the referral process.

4. Documentation and Workflow

Key Documents
• Physio Assessment (Facility-Specific Data Management System): Document initial and ongoing assessments.
• Progress Notes (Facility-Specific Data Management System): Keep detailed records of clinical interactions and treatments.
• Mobility Guides (ACP Mobility Guide Tool): Update mobility guidelines for residents.
• Bed Pole Risk Assessment (ACP ZOHO Sheet): Assess and document risks related to the use of bed poles.
• Wellness Program Documentation (ACP ZOHO Sheet): Record assessments and treatment plans for wellness programs.
• Daily Handover Form: Communicate critical resident information at the end of each shift to facility staff.

Documentation Guidelines
• Complete Initial Assessments within 24 hours for new residents.
• Perform Three-Monthly Reviews of mobility guides and treatment plans.
• Conduct Post-Fall Reviews and update records as necessary.
• Review Wellness Programs every six months for enrolled residents.

5. Equipment Use and Management

Therapist Responsibilities
• Identify residents’ equipment needs (e.g., beds, mattresses, hoists) during assessments.
• Coordinate equipment orders with facility management and residents' families.
• Train staff and residents on the safe and proper use of prescribed equipment.

Types of Equipment and Prescription Criteria
• Beds: Floorline beds for fall prevention; hospital or bariatric beds for residents requiring specialised support.
• Mattresses: Pressure-relieving mattresses for residents at risk of developing pressure ulcers.
• Hoists and Slings: For residents requiring assistance with transfers; slings should be selected based on the resident’s needs (e.g., hygiene sling for toileting).
• Walking Frames and Wheelchairs: Assess residents' mobility and recommend appropriate assistive devices, such as rollators, wheelchairs, or tilt-in-space chairs.
• Crash Mats and Sensor Mats: Use to minimise fall injuries and alert staff to unsupervised movement.

Prescription and Equipment Ordering
• Clinical Reasoning: Use assessments like the Waterlow Scale to determine the need for pressure care equipment.
• Process for Ordering Equipment: Follow the steps to gain approval for orders, including consent from the resident or their next of kin when required.

6. Patient Rights and Ethical Responsibilities
• Patient Autonomy: Ensure residents are involved in decision-making about their care and treatment.
• Privacy and Confidentiality: Adhere to strict guidelines in protecting patient information.
• Culturally Competent Care: Deliver care that is sensitive to the cultural backgrounds of residents, particularly for Aboriginal and Torres Strait Islander communities.
• Complaints Management: Maintain an open and transparent complaints-handling process and ensure that all feedback is recorded and addressed promptly.

7. Workplace Health and Safety (WHS)
• Infection Control: Adhere to infection prevention measures, including PPE usage.
• Manual Handling: Follow safe manual handling practices to avoid injury to staff and residents.
• Emergency Procedures: Be familiar with facility-specific fire safety, patient evacuation, and medical emergency protocols.
• Professional Indemnity Insurance (PII): Ensure all practising staff are appropriately covered for professional indemnity.

8. Professional Development and Competence
• CPD Requirements: Complete at least 20 hours of CPD annually to maintain physiotherapy registration and enhance clinical knowledge.
• Recency of Practice: Ensure at least 450 hours of practice over the past three years to maintain registration.
• Supervised Practice: New graduates or returning practitioners must complete supervised practice under a structured supervision plan.

9. Emergency Protocols and Critical Incidents
• Incident Reporting: Immediately report and document any critical incidents, such as falls or medical emergencies.
• Post-Fall Procedures: Conduct detailed post-fall reviews, update mobility guides, and communicate changes with the multidisciplinary team.
• Medical Emergencies: Follow the facility’s protocols for handling medical emergencies, including contacting relevant healthcare professionals.

10. Communication and Handover
• Daily Handover: At the end of each shift, complete the Physio Handover Form to ensure all relevant information is passed to facility staff.
• Interdisciplinary Communication: Maintain open communication with other healthcare professionals involved in the resident’s care, including nurses, GPs, and other allied health professionals.

11. Risk Management and Continuous Improvement
• Dignity of Risk: Respect residents’ autonomy while ensuring their safety and well-being.
• Feedback and Audits: Regularly collect feedback from staff and residents to identify areas for improvement. Conduct audits to ensure adherence to best practices and standards.$body$, true, 0),
  ('Clinical Process Manual for Physiotherapists in Aged Care Settings', 'Clinical Guides', $body$Clinical Process Manual for Physiotherapists in Aged Care Settings

1. Initial Assessment

Objective:
To assess the physical, functional, and mobility status of new residents within 24 hours of admission and create an individualised treatment plan.

Process:

1.  Preparation:
• Review the resident's medical history and any relevant clinical documentation (e.g., referrals, past injuries).
• Familiarise yourself with the resident’s care plan and current health status.
2.  Conduct Assessment:
• Subjective Examination:
• Gather information from the resident or family members regarding mobility, pain, recent injuries, falls, or relevant concerns.
• Objective Examination:
• Assess strength, range of motion, balance, gait, posture, and functional abilities (e.g., bed mobility, transfers).
• Conduct specific mobility tests (e.g., Timed Up and Go (TUG), Berg Balance Scale).
3.  Document Findings:
• Complete the Physio Assessment in the facility-specific data management system.
• Document relevant observations in Progress Notes.
4.  Develop a Treatment Plan:
• Create an individualised care plan outlining interventions such as exercises, mobility aids, or manual therapy.
• Set short- and long-term goals for mobility and function.
5.  Communication:
• Communicate the plan with facility staff, the resident, and family as needed.
• Ensure the Mobility Guide is updated and placed in the resident’s room.

2. Three-Monthly Reviews

Objective:
To review the resident’s mobility and treatment progress every three months, ensuring the care plan remains effective.

Process:

1.  Review Current Status:
• Review the resident’s medical notes, past assessments, and current care plan.
• Check for any recent incidents, falls, or changes in health status.
2.  Conduct Assessment:
• Re-assess mobility, strength, balance, and functional abilities (e.g., transfers, walking, ADLs).
• Evaluate the effectiveness of any prescribed equipment (e.g., walking aids, wheelchairs).
3.  Document Findings:
• Update the Physio Assessment in the facility-specific data management system.
• Record the resident’s progress or changes in the Progress Notes.
4.  Update Mobility Guide:
• Revise the Mobility Guide using the ACP Mobility Guide Tool as needed, ensuring it is printed and placed in the resident's room.
5.  Communicate Changes:
• Inform facility staff of any updates to the resident’s care plan or mobility needs during shift handover.

3. Post-Fall Reviews

Objective:
To evaluate the causes and impact of a fall, ensure safety, and prevent future falls.

Process:

1.  Review the Incident Report:
• Review the incident report for details on the fall (e.g., time, location, cause, injuries).
2.  Conduct Physical Examination:
• Assess the resident for injuries (e.g., bruises, fractures, pain) and observe mobility post-fall.
• Check balance, gait, and safety of transfers.
3.  Environment Assessment:
• Examine the environment (e.g., room layout, furniture) for hazards that may have contributed to the fall.
4.  Develop Preventive Strategies:
• Identify reasons for the fall (e.g., poor balance, medication, environmental factors) and propose preventive measures (e.g., bed sensors, crash mats).
5.  Document the Review:
• Record the post-fall assessment in the Progress Notes.
• Update the Mobility Guide and print a new copy for the resident’s room.
6.  Communicate the Findings:
• Provide recommendations to facility staff in the handover form to implement safety strategies.
• Educate the resident and family on fall prevention strategies.

4. Referral for Pressure Injuries / Risk

Objective:
To assess, treat, and prevent pressure injuries by recommending appropriate interventions.

Process:

1.  Review the Referral:
• Assess the details of the referral, including the stage, location, and severity of the pressure injury.
2.  Conduct Assessment:
• Perform a thorough skin inspection and evaluate risk factors (e.g., immobility, incontinence).
• Assess the resident’s posture, equipment use (e.g., mattress, wheelchair), and ability to reposition.
3.  Collaborate with Nursing Staff:
• Work with the nursing team to implement wound care strategies, positioning, and pressure relief.
4.  Prescribe Equipment:
• Recommend pressure-relieving devices (e.g., alternating air mattress, pressure cushions).
• Develop a repositioning schedule.
5.  Document the Plan:
• Record all assessments and recommendations in the Progress Notes.
• Communicate with the multidisciplinary team and family.

5. Bed Pole Risk Assessment

Objective:
To assess the safety of bed poles for residents and prevent injury.

Process:

1.  Identify Need for Bed Pole:
• Evaluate the resident’s functional ability and need for assistance with bed mobility.
2.  Assess Risk:
• Check for cognitive impairments, strength limitations, and fall risk to determine if a bed pole is appropriate or dangerous.
3.  Document the Risk Assessment:
• Complete the Bed Pole Risk Assessment using the ACP ZOHO Sheet.
4.  Update Mobility Guide:
• Ensure that any recommendations (use of bed pole, alternatives) are updated in the Mobility Guide.
5.  Communicate the Plan:
• Notify staff of the assessment results and ensure they are familiar with the appropriate use of bed poles.

6. Change of Mobility Review

Objective:
To review and assess changes in a resident’s mobility due to injury, illness, or other factors.

Process:

1.  Review Changes:
• Investigate the cause of the mobility change (e.g., injury, health deterioration, or improvement).
2.  Conduct a Physical Assessment:
• Assess strength, range of motion, balance, and gait.
• Check for new pain, weakness, or postural changes.
3.  Document Findings:
• Update the Physio Assessment in the facility-specific data management system.
• Record observations and new recommendations in the Progress Notes.
4.  Update Mobility Guide:
• Modify the Mobility Guide and place an updated copy in the resident’s room.
5.  Communicate Changes:
• Inform staff and family of the changes and the updated mobility plan during shift handover.

7. Manual Handling Review

Objective:
To assess manual handling techniques and ensure safe practices for both residents and staff.

Process:

1.  Assess the Resident’s Mobility:
• Review the resident’s current mobility, transfer ability, and use of equipment (e.g., hoists, slings).
2.  Evaluate Staff Techniques:
• Observe staff during manual handling tasks (e.g., transfers, repositioning) to ensure they are using safe techniques.
3.  Document Observations:
• Record manual handling issues and areas for improvement in the Progress Notes.
4.  Training and Education:
• Provide staff with training on correct manual handling procedures and the use of assistive devices.
5.  Follow-Up:
• Reassesses after training to ensure safe practices are being followed.

8. Equipment Assessment

Objective:
To assess the need for assistive equipment and ensure the resident’s safety and comfort.

Process:

1.  Assess the Resident’s Needs:
• Evaluate the resident’s physical condition and identify equipment needs (e.g., hoists, wheelchairs, mattresses).
2.  Trial Equipment:
• Arrange trials of equipment where possible and observe the resident’s response.
3.  Document the Assessment:
• Record the equipment needs and recommendations in the Progress Notes and Physio Assessment.
4.  Coordinate Orders:
• Liaise with facility management and suppliers to order the required equipment.
5.  Train Staff and Residents:
• Ensure all relevant staff and the residents are trained on the safe use of the equipment.

9. Gait Aid Assessment / Review

Objective:
To assess or review the suitability of gait aids and ensure they meet the resident’s current mobility needs.

Process:

1.  Evaluate Gait and Balance:
• Assess the resident’s gait, balance, and strength to determine the need for a walking aid (e.g., walker, cane).
2.  Prescribe or Review Gait Aid:
• Select the most appropriate gait aid based on the assessment.
• Ensure the aid is the correct height and fits the resident's needs.
3.  Training and Safety:
• Train the resident on proper gait aid use, including safe walking techniques and maintenance.
4.  Document Findings:
• Record the assessment and recommendations in the Physio Assessment and Progress Notes.
5.  Monitor and Review:
• Reassess the use of the gait aid regularly to ensure continued safety and effectiveness.$body$, true, 1),
  ('Guide: Making Recommendations in Post-Fall Reviews', 'Clinical Guides', $body$Guide for Making Recommendations in Post-Fall Reviews for Physiotherapists

This guide assists physiotherapists in making recommendations during post-fall reviews based on various scenarios in aged care. Each scenario outlines the likely causes of the fall and offers specific preventive strategies that should be considered to reduce future fall risk.

General Post-Fall Review Process

1.  Review the Incident Report:
• Gather details about the fall (e.g., time, location, witness accounts, fall mechanism).
2.  Conduct a Physical Examination:
• Assess for injuries (e.g., bruises, fractures, pain) and check for new mobility impairments.
3.  Assess the Environment:
• Evaluate potential environmental hazards (e.g., room layout, clutter, lighting, flooring).
4.  Update the Mobility Guide and Care Plan:
• Adjust the resident’s mobility guide and care plan based on findings from the post-fall review.
5.  Communicate the Plan:
• Provide recommendations to the care team and resident's family to ensure proper fall prevention strategies are in place.

Scenario 1: Fall Due to Poor Balance

Likely Causes:
• Reduced postural stability or balance deficits.
• Difficulty standing from sitting, or transferring without assistance.

Assessment:
• Perform balance assessments (e.g., Berg Balance Scale, Timed Up and Go Test (TUG)).
• Observe gait and transfers.

Recommendations:
• Exercise Program: Implement a balance-focused exercise program to improve postural stability and reduce fall risk (e.g., standing exercises, leg strength).
• Assistive Devices: Prescribe walking aids (e.g., a cane or walker) to improve stability and safety during ambulation.
• Environmental Modifications: Suggest removing tripping hazards (e.g., rugs, furniture clutter) and installing grab bars where needed.
• Hip Protectors: For residents with balance issues, prescribe hip protectors to minimise injury in case of future falls.

Scenario 2: Fall Due to Muscle Weakness

Likely Causes:
• Muscle weakness, especially in the lower extremities, contributes to difficulty with transfers and walking.

Assessment:
• Conduct a strength assessment, focusing on the lower body.
• Review functional ability, especially during transfers and walking.

Recommendations:
• Strengthening Exercises: Implement a progressive resistance training program to build muscle strength, especially in the legs.
• Nutritional Support: Collaborate with the dietitian to ensure the resident receives adequate protein and nutrition to support muscle function.
• Use of Hoists or Transfer Aids: Consider recommending the use of transfer aids such as a standing hoist if the resident cannot safely transfer independently.
• Gait Belts: Use gait belts during transfers to provide additional support and ensure safety.
• Joint Protection: Recommend knee or elbow protectors for residents prone to falls due to muscle weakness.

Scenario 3: Fall Due to Cognitive Impairment

Likely Causes:
• Cognitive impairments (e.g., dementia, confusion) lead to poor decision-making, wandering, or attempting activities unsafely.

Assessment:
• Review cognitive assessments and observe the resident’s behaviour for signs of confusion, agitation, or wandering.
• Assess the resident’s ability to follow safety instructions.

Recommendations:
• Supervision: Increase supervision during high-risk activities such as walking, toileting, and transfers.
• Structured Routine: Create a structured daily routine to reduce confusion and improve predictability.
• Safety Devices: Install bed and chair alarms to alert staff if the resident attempts to get up unsupervised.
• Wander Guards: If wandering is a concern, use wander guard systems to prevent unsupervised exits.
• Environmental Modifications: Reduce environmental hazards and increase visibility (e.g., night lights, clear signage) to help orient the resident.

Scenario 4: Fall Due to Environmental Factors

Likely Causes:
• Slippery floors, poor lighting, clutter, or poorly placed furniture contribute to the resident losing balance or tripping.

Assessment:
• Conduct an environmental assessment, focusing on the layout, lighting, and flooring conditions in the resident’s room and common areas.

Recommendations:
• Flooring and Footwear: Ensure that non-slip mats are placed in key areas (e.g., bathroom) and recommend proper, well-fitting, anti-slip footwear for the resident.
• Improve Lighting: Suggest increasing lighting in dim areas, especially in hallways and bathrooms, to prevent falls during nighttime or low-visibility hours.
• Furniture Layout: Recommend re-arranging furniture to create clear walking paths and reduce obstacles that could cause tripping.
• Assistive Devices: Consider using sensor mats or bed exit alarms for high-risk residents to alert staff if the resident attempts to get up alone.

Scenario 5: Fall Due to Self-Toileting or Unsuitable Bathroom Setup

Likely Causes:
• Resident attempts to self-toilet without assistance, leading to falls in the bathroom or while transferring.

Assessment:
• Review the incident details regarding the resident’s toileting habits.
• Assess the bathroom setup (e.g., availability of grab rails, toilet height).

Recommendations:
• Scheduled Toileting: Introduce a scheduled toileting plan to reduce the likelihood of the resident attempting to toilet independently.
• Bathroom Modifications: Install grab bars near the toilet and in the shower, and consider recommending a raised toilet seat for easier transfers.
• Assistive Devices: Recommend using a toilet frame for residents who need support during transfers.
• Visual Checks: Encourage regular visual checks, especially for residents who have a history of self-toileting without assistance.

Scenario 6: Fall Due to Medications

Likely Causes:
• Side effects of medications (e.g., dizziness, drowsiness, low blood pressure) contribute to balance issues or fainting spells.

Assessment:
• Review the resident’s medication list in consultation with a pharmacist or GP.
• Observe for signs of medication-related issues (e.g., dizziness, unsteadiness).

Recommendations:
• Medication Review: Collaborate with the resident’s GP or pharmacist to review and adjust medications that may increase fall risk (e.g., sedatives, blood pressure medications).
• Fall Risk Education: Educate the resident and family on the potential side effects of their medications and how to manage them (e.g., rising slowly to prevent dizziness).
• Safety Interventions: Consider using balance aids or supportive devices while the resident is adjusting to new medication.

Scenario 7: Fall Due to Poor Gait or Footwear

Likely Causes:
• Incorrect or unsafe footwear (e.g., slippers without support) combined with an unsteady gait leads to falls.

Assessment:
• Observe the resident’s gait and footwear during ambulation.
• Assess for poor posture, weakness, or improper use of gait aids.

Recommendations:
• Proper Footwear: Recommend well-fitting, supportive, non-slip shoes to reduce the risk of falls.
• Gait Aid Assessment: Review and adjust the resident’s gait aid (e.g., cane, walker) to ensure it is the appropriate size and type for their needs.
• Gait Training: Implement a gait training program to improve walking patterns and increase stability during ambulation.
• Environmental Modifications: Suggest anti-slip mats or surfaces where the resident commonly walks, especially in bathrooms and kitchens.

Scenario 8: Fall Due to Transfer Issues

Likely Causes:
• Resident experiences difficulty during transfers (e.g., bed to chair) due to weakness, poor technique, or inadequate support.

Assessment:
• Observe transfers and assess whether the resident requires assistance or devices for safe transfers.

Recommendations:
• Transfer Training: Provide the resident with transfer training, focusing on techniques to reduce the risk of falls.
• Use of Transfer Aids: Recommend the use of transfer aids (e.g., transfer boards, sliding sheets) to improve safety during transfers.
• Hoists: If the resident cannot transfer independently, consider using a standing or full-body hoist for safe transfers.
• Manual Handling Review: Ensure staff are using safe manual handling techniques to support the resident during transfers.$body$, true, 2),
  ('Guide: Making Recommendations for Pressure Injury Referrals', 'Clinical Guides', $body$Guide for Making Recommendations for Pressure Injury Referrals in Aged Care for Physiotherapists

This guide is designed to assist physiotherapists in assessing and making appropriate recommendations when dealing with pressure injuries in aged care. Each scenario outlines potential causes and offers specific preventive and treatment strategies to address existing pressure injuries and reduce the risk of future occurrences.

General Pressure Injury Referral Process

1.  Review the Referral:
• Assess the details of the referral, including the location, stage, and severity of the pressure injury.
• Check relevant medical history and past occurrences of pressure injuries, mobility limitations, and other risk factors (e.g., incontinence, immobility).
2.  Conduct a Physical Examination:
• Inspect the site of the pressure injury and surrounding skin for signs of infection, redness, or additional pressure areas.
• Assess the resident’s ability to reposition themselves or their need for assistance.
3.  Collaborate with Nursing and Multidisciplinary Team:
• Work closely with the nursing staff, dietitians, and general practitioners to develop a coordinated care plan.
4.  Make Equipment Recommendations:
• Prescribe appropriate pressure-relieving devices (e.g., mattresses, cushions) and create a repositioning schedule.
5.  Document and Communicate the Plan:
• Record all findings and recommendations in the facility-specific data management system and communicate the plan with the care team and resident’s family.

Scenario 1: Early-Stage Pressure Injury (Stage 1-2)

Characteristics:
• Stage 1: Non-blanchable redness or discolouration of intact skin.
• Stage 2: Partial-thickness skin loss, presenting as a shallow open ulcer or blister.

Assessment:
• Inspect the affected area for redness, heat, or pain.
• Assess the resident’s mobility, ability to reposition, and current use of equipment (e.g., mattresses, cushions).

Recommendations:
• Pressure-Relieving Mattresses: Recommend a pressure-relieving mattress (e.g., foam or alternating air) to reduce pressure at the affected site.
• Positioning Aids: Use wedges or pillows to offload pressure from the injured area, ensuring frequent repositioning (every 2 hours).
• Education: Educate the resident (if appropriate) and care staff on the importance of repositioning and early detection of skin changes.
• Monitor Progress: Regularly monitor the pressure injury for signs of deterioration or improvement and adjust care accordingly.
• Nutritional Support: Collaborate with a dietitian to ensure the resident receives adequate nutrition for skin healing, focusing on protein and hydration.

Scenario 2: Advanced Pressure Injury (Stage 3-4)

Characteristics:
• Stage 3: Full-thickness skin loss, potentially exposing fat tissue.
• Stage 4: Full-thickness tissue loss with exposed bone, tendon, or muscle.

Assessment:
• Assess the wound depth, infection risk (e.g., drainage, odour), and overall skin condition.
• Evaluate the resident’s current equipment and their ability to reposition.

Recommendations:
• Alternating Pressure Mattress: For severe pressure injuries, recommend an advanced alternating air or low air loss mattress to relieve pressure on the wound site.
• Heel Protectors or Specialised Offloading Devices: If the injury is located on the heels or sacrum, use specialised devices to prevent further pressure.
• Frequent Repositioning: Develop and implement a repositioning schedule (e.g., every 2 hours in bed, every 30 minutes in a wheelchair) to reduce pressure on the wound.
• Wound Care Collaboration: Collaborate closely with the wound care team to ensure the appropriate dressings and treatments are applied. Ensure the physiotherapy interventions complement wound care protocols.
• Exercise Program: Implement a gentle mobility and range of motion exercise program to improve circulation and support overall skin health.

Scenario 3: Pressure Injuries Due to Immobility

Characteristics:
• Residents who are bedridden or have limited mobility, increasing their risk of pressure injuries in bony areas (e.g., heels, sacrum).

Assessment:
• Review the resident’s mobility limitations and current equipment.
• Assess skin integrity in high-risk areas (e.g., heels, back, buttocks).

Recommendations:
• Pressure-Relieving Equipment: Prescribe alternating pressure mattresses or high-specification foam mattresses to redistribute pressure.
• Positioning Aids: Use wedges, pillows, or cushions to help the resident reposition in bed or in a wheelchair, focusing on offloading pressure from bony areas.
• Wheelchair Cushions: If the resident is wheelchair-bound, prescribe air or gel cushions to relieve pressure and improve sitting posture.
• Repositioning Plan: Establish a repositioning schedule and educate the care staff on repositioning techniques.
• Active Bed Exercises: Encourage gentle range-of-motion exercises or active bed exercises (if possible) to maintain circulation and improve skin health.

Scenario 4: Pressure Injuries Due to Incontinence

Characteristics:
• Moisture-related pressure injuries, typically affecting areas exposed to urine or faeces.

Assessment:
• Examine the areas affected by incontinence and assess the condition of the skin.
• Review current moisture management strategies.

Recommendations:
• Moisture Management: Collaborate with the nursing team to ensure the implementation of an effective moisture management plan (e.g., barrier creams, absorbent pads).
• Frequent Repositioning: Ensure the resident is repositioned regularly to prevent moisture build-up on pressure areas.
• Appropriate Skin Care Products: Recommend skin-protecting products such as barrier creams to prevent breakdown due to moisture.
• Advanced Mattresses: Consider prescribing alternating air mattresses or moisture-resistant cushions to minimise pressure in moisture-prone areas.

Scenario 5: Pressure Injuries Due to Poor Posture in a Wheelchair

Characteristics:
• Pressure injuries occur on areas such as the sacrum, buttocks, or shoulders due to prolonged sitting in a poor posture.

Assessment:
• Assess the resident’s sitting posture, wheelchair positioning, and the fit of their current seating.
• Check for skin breakdown in areas exposed to prolonged pressure.

Recommendations:
• Wheelchair Adjustments: Adjust the resident’s wheelchair to improve their sitting posture and redistribute pressure more evenly.
• Pressure-Relieving Cushions: Prescribe a pressure-relieving cushion (e.g., air or gel cushions) to reduce pressure on the buttocks and sacral areas.
• Tilt-in-Space Wheelchair: If the resident has difficulty maintaining posture, consider recommending a tilt-in-space wheelchair to allow for weight shifting and better pressure distribution.
• Posture Education: Educate care staff on assisting the resident with posture adjustments throughout the day.
• Frequent Position Changes: Encourage the resident to perform seated repositioning exercises or to tilt the chair every 30 minutes to offload pressure.

Scenario 6: Pressure Injuries in Residents with Cognitive Impairments

Characteristics:
• Cognitive impairments (e.g., dementia) can lead to difficulty understanding the need to reposition or inability to communicate discomfort, increasing pressure injury risk.

Assessment:
• Assess the resident’s ability to follow instructions and participate in repositioning.
• Examine skin integrity in areas prone to pressure injuries.

Recommendations:
• Pressure Relief Devices: Recommend an alternating pressure mattress or cushion to provide continuous pressure relief.
• Scheduled Repositioning: Develop a structured repositioning schedule and ensure care staff are aware of the need for frequent position changes.
• Assistive Technology: Consider using sensor mats or alert devices to monitor when the resident is in the same position for too long.
• Engagement in Simple Mobility: Encourage simple exercises or movements that the resident can perform to improve circulation and reduce pressure injury risk, with the support of staff if needed.

Scenario 7: Pressure Injuries in Residents with Diabetes or Vascular Issues

Characteristics:
• Residents with diabetes or poor circulation are at increased risk of developing pressure injuries, especially in the feet, heels, or legs.

Assessment:
• Assess the resident’s skin for signs of vascular insufficiency (e.g., delayed wound healing, poor circulation).
• Examine areas prone to pressure injuries, such as the heels and lower legs.

Recommendations:
• Heel Offloading Devices: Use heel protectors or offloading boots to prevent pressure injuries on the heels.
• Pressure-Relieving Mattresses: Recommend an alternating pressure or foam mattress to reduce pressure in at-risk areas.
• Wound Care Consultation: Work closely with the wound care team to ensure the management of any existing wounds, particularly in the lower limbs.
• Circulation Exercises: Incorporate gentle leg and ankle exercises to promote blood flow and prevent further skin breakdown.

Scenario 8: Pressure Injuries from Improper Use of Equipment

Characteristics:
• Pressure injuries develop due to incorrect use of assistive devices (e.g., slings, bed rails, cushions) or equipment that doesn’t fit the resident’s needs.

Assessment:
• Evaluate the equipment currently being used (e.g., wheelchair, cushions, slings) and observe how it is being applied.
• Check skin integrity in areas affected by the equipment (e.g., under slings or straps).

Recommendations:
• Equipment Adjustments: Review and adjust the fit and usage of all assistive devices, ensuring they are not causing undue pressure.
• Training for Staff: Educate care staff on the proper use of equipment to prevent pressure-related injuries.
• Cushion/Support Reassessment: Replace or adjust cushions, supports, or slings as necessary to better distribute pressure and reduce the risk of skin breakdown.$body$, true, 3),
  ('Guide: Ordering and Organising Equipment', 'Clinical Guides', $body$Guide for Ordering and Organising Equipment in Aged Care

This guide is designed to assist physiotherapists in ordering and organising essential equipment in aged care settings. It covers various types of equipment, including mobility aids, seating solutions, protective gear, and pressure-relieving devices. Following this process ensures that equipment is selected, ordered, and organised efficiently to meet the specific needs of residents.

General Ordering Process for Equipment

1.  Assessment of Resident Needs:
• Conduct a detailed clinical assessment to determine the resident’s specific needs for mobility, seating, protection, or pressure relief.
• Involve the resident, their family, and other healthcare professionals in the decision-making process if required.
2.  Trial of Equipment:
• Whenever possible, arrange for a trial of the equipment to assess its suitability before making a final decision.
• Document the resident’s feedback and clinical observations during the trial.
3.  Obtain Approval:
• For high-cost equipment, ensure that approvals are obtained from the facility management, funding bodies (e.g., NDIS, DVA), or family members, if required.
4.  Place the Order:
• Use the facility’s preferred supplier system or the supplier list to place the order. Include relevant specifications (e.g., size, model) to ensure correct ordering.
• Keep records of the order, including delivery timelines and cost.
5.  Organise Delivery and Setup:
• Coordinate the delivery and setup of equipment, ensuring it is correctly installed and safe for use.
• Train staff and the resident in the proper use of the equipment.
6.  Maintenance and Follow-Up:
• Schedule regular checks for maintenance and repair to ensure the equipment remains in good working condition.
• Reassess the resident periodically to confirm the ongoing suitability of the equipment.

1. Wheelchairs

Purpose:
Provide mobility and independence for residents with limited walking ability.

Assessment:
• Assess the resident’s physical abilities (strength, balance, posture) and clinical needs (e.g., tilt-in-space for pressure relief, standard wheelchair for mobility).
• Determine the size and adjustability required (seat width, depth, and height).

Ordering Process:
• Select a model based on the resident’s needs (e.g., lightweight manual wheelchair, tilt-in-space wheelchair).
• Specify dimensions, any additional features (e.g., reclining back, leg rests), and weight capacity.
• Confirm the need for pressure-relieving cushions or back supports.

Organisation and Setup:
• Ensure the wheelchair is properly adjusted to the resident’s needs, including seat height, backrest, and footrests.
• Provide training to the resident and staff on safe transfers, propulsion, and manoeuvring.

2. Princess Chairs

Purpose:
Provide comfort and postural support for residents who spend prolonged periods sitting.

Assessment:
• Assess the resident’s postural needs, ability to transfer, and level of comfort required.
• Consider whether the resident needs additional features, such as reclining or tilt functions.

Ordering Process:
• Choose the appropriate size based on the resident’s weight and height.
• Specify features such as recline, tilt, adjustable footrests, or pressure-relief cushions.
• Check if the resident requires a motorised model for ease of adjustments.

Organisation and Setup:
• Ensure the chair is properly positioned in the resident’s living space to maximise comfort and accessibility.
• Provide instruction to staff on using the recline and tilt functions and transferring the resident safely.

3. Tilt-in-Space (TIS) Chairs

Purpose:
Provide pressure relief and postural support for residents with high needs, including those at risk of pressure injuries.

Assessment:
• Determine the resident’s pressure-relief needs and their ability to maintain posture.
• Assess whether a standard recliner or a TIS chair is most appropriate.

Ordering Process:
• Specify the TIS chair features (e.g., degree of tilt, head and neck support, leg elevation).
• Ensure it has the correct pressure-relieving properties, such as a ROHO or gel cushion, if needed.

Organisation and Setup:
• Ensure the chair is correctly adjusted for the resident, including the tilt mechanism.
• Provide instruction to staff on using the tilt function to adjust the resident’s position throughout the day to prevent pressure injuries.

4. Recliner Chairs

Purpose:
Provide relaxation, comfort, and support, particularly for residents with decreased mobility or those who rest frequently.

Assessment:
• Assess the resident’s comfort needs, level of independence, and ability to operate manual or electric recliners.
• Consider whether the chair will be used primarily for relaxation or postural support.

Ordering Process:
• Select the correct size and features, including manual or electric recline, lumbar support, and leg elevation.
• Consider additional options, such as heat and massage functions for comfort.

Organisation and Setup:
• Ensure the chair is placed in a suitable location where the resident can easily transfer in and out.
• Provide instruction on how to operate the chair safely and comfortably.

5. Hip Protectors

Purpose:
Reduce the risk of hip fractures in residents prone to falls.

Assessment:
• Assess the resident’s fall risk and determine the suitability of hip protectors, particularly for residents with osteoporosis or frequent falls.

Ordering Process:
• Select the appropriate size and style based on the resident’s needs and preferences (e.g., pants with built-in pads, slip-on hip protectors).
• Ensure the protectors provide effective coverage of the hips and do not interfere with comfort or mobility.

Organisation and Setup:
• Ensure the resident understands how to wear the hip protectors, and provide assistance as needed.
• Educate staff and the resident on the importance of wearing the protectors consistently.

6. Tubigrips

Purpose:
Provide compression and support for soft tissue injuries, swelling, or joint issues.

Assessment:
• Assess the resident for conditions requiring compression (e.g., oedema, mild joint pain).
• Measure the limb to determine the correct size of the tubigrip.

Ordering Process:
• Order the appropriate size and length based on the resident’s limb measurements.
• Choose single-use or reusable tubigrips depending on the resident’s needs.

Organisation and Setup:
• Ensure the tubigrip is applied properly, without being too tight or loose, and provide education on how to apply and remove it safely.

7. ROHO Cushions

Purpose:
Provide pressure relief and improve comfort for residents at risk of pressure injuries.

Assessment:
• Assess the resident’s pressure injury risk, sitting posture, and skin condition, particularly for wheelchair users.

Ordering Process:
• Specify the correct size and thickness of the ROHO cushion based on the resident’s seating needs (e.g., wheelchair seat, recliner).
• Determine whether a low-profile or high-profile ROHO cushion is more appropriate based on the resident’s skin condition and posture.

Organisation and Setup:
• Inflate and adjust the ROHO cushion according to the resident’s weight and pressure-relief needs.
• Regularly check for proper inflation and provide training to staff and the resident on maintaining and using the cushion correctly.

8. Diffuser Cushions

Purpose:
Provide general comfort and pressure distribution for residents with mild pressure-relief needs.

Assessment:
• Assess the resident’s sitting comfort and skin integrity to determine if a diffuser cushion is suitable.

Ordering Process:
• Select the appropriate size for the resident’s chair or wheelchair.
• Consider additional features, such as washable covers or custom sizing.

Organisation and Setup:
• Ensure the diffuser cushion is properly positioned in the resident’s chair or wheelchair for optimal comfort.
• Educate the resident and staff on cleaning and maintaining the cushion.

9. Air Mattresses

Purpose:
Provide pressure relief for residents at high risk of developing pressure injuries, especially those who are immobile or bedridden.

Assessment:
• Assess the resident’s pressure injury risk using tools such as the Waterlow Scale or Braden Scale.
• Determine whether the resident requires a low-air-loss or alternating pressure mattress.

Ordering Process:
• Choose the appropriate type of air mattress based on the resident’s risk level and bed size.
• Specify features such as automatic pressure adjustment, moisture control, or alternating pressure cycles.

Organisation and Setup:
• Ensure the air mattress is installed correctly, with appropriate pressure settings for the resident’s weight and skin integrity.
• Train staff on how to operate and adjust the mattress to provide optimal pressure relief and prevent breakdowns.
• Schedule regular maintenance checks to ensure the mattress remains functional.$body$, true, 4),
  ('Policy on Police Check Requirements in Aged Care', 'HR & Compliance', $body$Policy on Police Check Requirements in Aged Care

1. Purpose

This policy outlines the requirements for obtaining police checks for all employees and volunteers within our aged care facility. It reflects recent changes in legislation and organisational procedures, ensuring compliance with the Aged Care Act 1997 and associated guidelines.

2. Scope

This policy applies to all current and prospective employees, contractors, and volunteers who have, or are likely to have, access to care recipients within our aged care services.

3. Background

Under the Aged Care Act 1997, it is mandatory for individuals working in aged care to undergo a National Police Check to ensure the safety and well-being of care recipients. Recent amendments have shifted the responsibility of obtaining these checks from the employer to the individual.

4. Policy Statement
• Individual Responsibility: All employees, contractors, and volunteers are required to obtain their own National Police Check prior to commencing work. The organisation will no longer apply for police checks on behalf of candidates.
• Validity: Police checks must be dated within the last three years to be considered valid.
• Submission: A certified copy of the police check must be submitted to the Human Resources department before the commencement of duties.

5. Procedure
• Application: Individuals can apply for a National Police Check through accredited agencies or the local police authority.
• Cost: The cost of obtaining the police check is the responsibility of the individual.
• Record Keeping: The organisation will maintain a record of the police check certificate in the individual's personnel file.

6. Compliance

Failure to provide a valid police check will result in the individual being ineligible to work within our aged care services.

7. Review

This policy will be reviewed annually or as required to ensure compliance with legislative changes.

8. References
• Aged Care Act 1997
• Aged Care Worker Screening Guidelines

9. Contact

For any questions regarding this policy, please contact the Human Resources department.$body$, true, 5);
