package fixture;
public final class SmokeTest extends junit.framework.TestCase {
  public void testDatabaseQuery() throws Exception { assertEquals(42, App.smoke()); }
}
