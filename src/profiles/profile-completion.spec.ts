import { computeProfileCompletion } from './profile-completion';

describe('computeProfileCompletion', () => {
  it('returns 0 for empty profile and unverified phone', () => {
    expect(
      computeProfileCompletion(
        {
          photoUrl: null,
          bio: '',
          profession: null,
          budgetMin: null,
          budgetMax: null,
          moveInDate: null,
          lifestyleTags: [],
        },
        { phoneVerified: false },
      ),
    ).toBe(0);
  });

  it('adds points when sections are filled and phone verified', () => {
    expect(
      computeProfileCompletion(
        {
          photoUrl: 'https://cdn.burrow.in/x/y.jpg',
          bio: 'x'.repeat(40),
          profession: 'Engineer',
          budgetMin: 10000,
          budgetMax: 30000,
          moveInDate: new Date('2026-07-01'),
          lifestyleTags: ['Chill'],
        },
        { phoneVerified: true },
      ),
    ).toBe(100);
  });

  it('caps at 100', () => {
    expect(
      computeProfileCompletion(
        {
          photoUrl: 'https://cdn.burrow.in/a/b.jpg',
          bio: 'x'.repeat(50),
          profession: 'Engineer',
          budgetMin: 10000,
          budgetMax: 30000,
          moveInDate: new Date(),
          lifestyleTags: ['Chill', 'Foodie'],
        },
        { phoneVerified: true },
      ),
    ).toBe(100);
  });
});
